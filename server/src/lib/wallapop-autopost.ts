import type { Prisma, PrismaClient } from "../../generated/prisma/client"

import { findDefaultAccountId } from "./default-account"
import { getPrisma } from "./db"
import { log, serializeError } from "./log"
import { getBrowserBusy } from "./wallapop-cdp"
import { getWallapopSessionSnapshot } from "./wallapop-session"
import { runProductPublish } from "../routes/product-publish"

/** Default ~15 min. Override with `WALLAPOP_AUTOPOST_INTERVAL_MS`. */
export const DEFAULT_AUTOPOST_INTERVAL_MS = 15 * 60 * 1000

const JITTER_FRACTION = 0.2

let started = false
let scheduling = false

/** Exact string `true` — unset / `1` / `TRUE` stay off. */
export function isWallapopAutopostEnabled(): boolean {
  return process.env.WALLAPOP_AUTOPOST === "true"
}

/**
 * Live Publicar only when env is exactly `false`.
 * Unset / `true` keep the queue idle (no Chrome). Same rule as publish env.
 */
export function isAutopostLivePublishEnabled(): boolean {
  return process.env.WALLAPOP_PUBLISH_DRY_RUN === "false"
}

export function readAutopostIntervalMs(): number {
  const raw = process.env.WALLAPOP_AUTOPOST_INTERVAL_MS
  if (raw == null || raw.trim() === "") return DEFAULT_AUTOPOST_INTERVAL_MS
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_AUTOPOST_INTERVAL_MS
  return n
}

/**
 * ±20% around the base interval so ticks are not metronomic.
 * `random` is injectable for tests (0 → −20%, 0.5 → 0%, 1 → +20%).
 */
export function autopostDelayWithJitter(
  intervalMs: number,
  random: () => number = Math.random,
): number {
  const spread = intervalMs * JITTER_FRACTION
  return Math.max(0, Math.round(intervalMs + (random() * 2 - 1) * spread))
}

/**
 * Eligible queue row on the default account.
 * Only `READY_TO_POST` — never POSTING / ACTIVE / DEACTIVATED (anti-duplicate
 * after crash-after-Publicar; POSTING is not retried even if the enum exists).
 */
export function autopostEligibleListingWhere(
  accountId: string,
): Prisma.ProductListingWhereInput {
  return {
    accountId,
    status: "READY_TO_POST",
    externalUrl: null,
    product: {
      status: "ACTIVE",
      images: { some: {} },
    },
  }
}

/** Oldest listing first (FIFO). `createdAt`, not `updatedAt` — edits must not jump the queue. */
export const AUTOPOST_PICK_ORDER_BY = { createdAt: "asc" } as const

export async function findNextAutopostListing(
  prisma: PrismaClient,
  accountId: string,
) {
  return prisma.productListing.findFirst({
    where: autopostEligibleListingWhere(accountId),
    orderBy: AUTOPOST_PICK_ORDER_BY,
    select: { id: true, productId: true, createdAt: true },
  })
}

/** True only when env is on and timers are scheduled. */
export function isWallapopAutopostLoopScheduling(): boolean {
  return scheduling
}

/**
 * Fire-and-forget in-process loop. Idempotent if called twice.
 * No-op unless `WALLAPOP_AUTOPOST=true`. Never throws.
 */
export function startWallapopAutopostLoop(): void {
  try {
    if (started) {
      log("info", "wallapop_autopost_already_started")
      return
    }

    if (!isWallapopAutopostEnabled()) {
      log("info", "wallapop_autopost_disabled")
      return
    }

    started = true
    const intervalMs = readAutopostIntervalMs()
    scheduling = true
    log("info", "wallapop_autopost_started", {
      intervalMs,
      livePublish: isAutopostLivePublishEnabled(),
    })
    scheduleNext(intervalMs)
  } catch (error) {
    log("error", "wallapop_autopost_start_failed", serializeError(error))
  }
}

function scheduleNext(intervalMs: number): void {
  const delayMs = autopostDelayWithJitter(intervalMs)
  setTimeout(() => {
    void runAutopostTick()
      .catch((error) => {
        log("error", "wallapop_autopost_tick_failed", serializeError(error))
      })
      .finally(() => scheduleNext(intervalMs))
  }, delayMs)
}

/**
 * One queue tick. Exported for tests — pass a mock publish so Vitest never
 * opens Chrome. Dry-run env skips before session / pick / publish.
 */
export async function runAutopostTick(
  publishProduct: typeof runProductPublish = runProductPublish,
): Promise<void> {
  if (!isAutopostLivePublishEnabled()) {
    log("info", "wallapop_autopost_idle_until_live")
    return
  }

  log("info", "wallapop_autopost_tick")

  const session = await getWallapopSessionSnapshot()
  if (session.status !== "ACTIVE") {
    log("info", "wallapop_autopost_skip_session", { status: session.status })
    return
  }

  const busy = getBrowserBusy()
  if (busy !== "idle") {
    log("info", "wallapop_autopost_skip_busy", { busy })
    return
  }

  const prisma = getPrisma()
  if (!prisma) {
    log("warn", "wallapop_autopost_skip_no_db")
    return
  }

  const accountId = await findDefaultAccountId(prisma)
  if (!accountId) {
    log("warn", "wallapop_autopost_skip_no_account")
    return
  }

  const listing = await findNextAutopostListing(prisma, accountId)
  if (!listing) {
    log("info", "wallapop_autopost_idle")
    return
  }

  log("info", "wallapop_autopost_pick", {
    listingId: listing.id,
    productId: listing.productId,
  })

  const result = await publishProduct(listing.productId, { dryRun: false })
  if (!result.ok) {
    log("warn", "wallapop_autopost_publish_failed", {
      listingId: listing.id,
      productId: listing.productId,
      code: result.code,
      message: result.message,
    })
    return
  }

  log("info", "wallapop_autopost_publish_ok", {
    listingId: listing.id,
    productId: listing.productId,
    dryRun: result.dryRun,
    step: result.step,
  })
}
