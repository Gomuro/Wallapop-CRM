import type { Prisma, PrismaClient } from "../../generated/prisma/client"

import { listingWithoutPublicItemUrlWhere } from "../../../lib/inventory/wallapop-item-url"
import {
  AUTOPOST_INTERVAL_MS_MAX,
  AUTOPOST_INTERVAL_MS_MIN,
} from "../../../lib/validations/account"
import {
  isShippingPublishReady,
  SHIPPING_NOT_READY_CODE,
  SHIPPING_NOT_READY_MESSAGE,
} from "../../../lib/inventory/shipping-for-publish"
import {
  getRecentAutopostSkips,
  recordAutopostSkip,
} from "./autopost-recent-skips"
import { findDefaultAccountId } from "./default-account"
import { getPrisma } from "./db"
import { log, serializeError } from "./log"
import { getBrowserBusy } from "./wallapop-cdp"
import { getWallapopSessionSnapshot } from "./wallapop-session"
import { runProductPublish } from "../routes/product-publish"

/** Default ~15 min. Override with account UI, else `WALLAPOP_AUTOPOST_INTERVAL_MS`. */
export const DEFAULT_AUTOPOST_INTERVAL_MS = 15 * 60 * 1000

export { AUTOPOST_INTERVAL_MS_MAX, AUTOPOST_INTERVAL_MS_MIN }

export const AUTOPOST_JITTER_FRACTION = 0.2

export type AutopostIntervalSource = "account" | "env" | "default"

export type AutopostIntervalResolution = {
  effectiveIntervalMs: number
  source: AutopostIntervalSource
  storedIntervalMs: number | null
}

let started = false
let scheduling = false
let scheduleTimer: ReturnType<typeof setTimeout> | null = null
let scheduleGeneration = 0
/** Wall clock when the in-process timer will run `runAutopostTick` (not publish finish). */
let nextAutopostTickAtMs: number | null = null

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

/** Env-only interval, or null when unset / invalid (caller falls back to default). */
export function readAutopostIntervalMsFromEnv(): number | null {
  const raw = process.env.WALLAPOP_AUTOPOST_INTERVAL_MS
  if (raw == null || raw.trim() === "") return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

/** Env or 15 min. Does not read the account column — use `resolveAutopostIntervalMs`. */
export function readAutopostIntervalMs(): number {
  return readAutopostIntervalMsFromEnv() ?? DEFAULT_AUTOPOST_INTERVAL_MS
}

function isPositiveIntervalMs(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value > 0
}

export async function resolveAutopostInterval(
  prisma?: PrismaClient | null,
): Promise<AutopostIntervalResolution> {
  const client = prisma === undefined ? getPrisma() : prisma
  let storedIntervalMs: number | null = null
  if (client) {
    const account = await client.account.findFirst({
      where: { isDefault: true },
      select: { autopostIntervalMs: true },
    })
    if (isPositiveIntervalMs(account?.autopostIntervalMs)) {
      storedIntervalMs = account.autopostIntervalMs
    }
  }

  if (storedIntervalMs != null) {
    return {
      effectiveIntervalMs: storedIntervalMs,
      source: "account",
      storedIntervalMs,
    }
  }

  const envMs = readAutopostIntervalMsFromEnv()
  if (envMs != null) {
    return {
      effectiveIntervalMs: envMs,
      source: "env",
      storedIntervalMs: null,
    }
  }

  return {
    effectiveIntervalMs: DEFAULT_AUTOPOST_INTERVAL_MS,
    source: "default",
    storedIntervalMs: null,
  }
}

export async function resolveAutopostIntervalMs(
  prisma?: PrismaClient | null,
): Promise<number> {
  const { effectiveIntervalMs } = await resolveAutopostInterval(prisma)
  return effectiveIntervalMs
}

export function toAutopostStatusJson(
  resolution: AutopostIntervalResolution,
  extras: {
    enabled: boolean
    lastPublication: { at: string; title: string } | null
    nextTickAt: string | null
    recentSkips?: ReturnType<typeof getRecentAutopostSkips>
  },
) {
  return {
    effectiveIntervalMs: resolution.effectiveIntervalMs,
    source: resolution.source,
    jitterFraction: AUTOPOST_JITTER_FRACTION,
    enabled: extras.enabled,
    livePublish: isAutopostLivePublishEnabled(),
    lastPublication: extras.lastPublication,
    nextTickAt: extras.nextTickAt,
    recentSkips: extras.recentSkips ?? getRecentAutopostSkips(),
  }
}

/** ISO timestamp of the next scheduled queue tick, or null if the loop is not scheduling. */
export function getNextAutopostTickAt(): string | null {
  if (nextAutopostTickAtMs == null) return null
  return new Date(nextAutopostTickAtMs).toISOString()
}

export async function loadAutopostStatus(prisma: PrismaClient) {
  const resolution = await resolveAutopostInterval(prisma)
  const account = await prisma.account.findFirst({
    where: { isDefault: true },
    select: { autopostEnabled: true },
  })
  const last = await prisma.productListing.findFirst({
    where: {
      account: { isDefault: true },
      lastPostedAt: { not: null },
    },
    orderBy: { lastPostedAt: "desc" },
    select: {
      lastPostedAt: true,
      product: { select: { title: true } },
    },
  })
  const enabled = account?.autopostEnabled === true
  return toAutopostStatusJson(resolution, {
    enabled,
    lastPublication:
      last?.lastPostedAt != null
        ? { at: last.lastPostedAt.toISOString(), title: last.product.title }
        : null,
    nextTickAt: enabled ? getNextAutopostTickAt() : null,
    recentSkips: getRecentAutopostSkips(),
  })
}

export async function isDefaultAccountAutopostEnabled(
  prisma?: PrismaClient | null,
): Promise<boolean> {
  const client = prisma === undefined ? getPrisma() : prisma
  if (!client) return false
  const account = await client.account.findFirst({
    where: { isDefault: true },
    select: { autopostEnabled: true },
  })
  return account?.autopostEnabled === true
}

/**
 * ±20% around the base interval so ticks are not metronomic.
 * `random` is injectable for tests (0 → −20%, 0.5 → 0%, 1 → +20%).
 */
export function autopostDelayWithJitter(
  intervalMs: number,
  random: () => number = Math.random,
): number {
  const spread = intervalMs * AUTOPOST_JITTER_FRACTION
  return Math.max(0, Math.round(intervalMs + (random() * 2 - 1) * spread))
}

/**
 * Eligible queue row on the default account.
 * Only `READY_TO_POST` — never POSTING / ACTIVE / DEACTIVATED (anti-duplicate
 * after crash-after-Publicar; POSTING is not retried even if the enum exists).
 * A leftover upload/home URL is not a published item — still eligible.
 */
export function autopostEligibleListingWhere(
  accountId: string,
): Prisma.ProductListingWhereInput {
  return {
    accountId,
    status: "READY_TO_POST",
    ...listingWithoutPublicItemUrlWhere,
    product: {
      status: "ACTIVE",
      images: { some: {} },
      AND: [{ brand: { not: null } }, { NOT: { brand: "" } }],
    },
  }
}

/** Oldest listing first (FIFO). `createdAt`, not `updatedAt` — edits must not jump the queue. */
export const AUTOPOST_PICK_ORDER_BY = { createdAt: "asc" } as const

export const AUTOPOST_PICK_BATCH = 30

function decimalToNumberOrNull(
  value: { toString(): string } | number | null | undefined,
): number | null {
  if (value == null) return null
  const n = typeof value === "number" ? value : Number(value.toString())
  return Number.isFinite(n) ? n : null
}

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

export async function pickNextAutopostListing(
  prisma: PrismaClient,
  accountId: string,
): Promise<{
  listing: { id: string; productId: string; createdAt: Date } | null
  scanned: number
  skipped: number
}> {
  const candidates = await prisma.productListing.findMany({
    where: autopostEligibleListingWhere(accountId),
    orderBy: AUTOPOST_PICK_ORDER_BY,
    take: AUTOPOST_PICK_BATCH,
    select: {
      id: true,
      productId: true,
      createdAt: true,
      product: {
        select: {
          sku: true,
          title: true,
          weightKg: true,
          widthCm: true,
          lengthCm: true,
          heightCm: true,
        },
      },
    },
  })

  let skipped = 0
  for (const listing of candidates) {
    const product = listing.product
    const ready = isShippingPublishReady({
      weightKg: decimalToNumberOrNull(product.weightKg),
    })
    if (ready) {
      return {
        listing: {
          id: listing.id,
          productId: listing.productId,
          createdAt: listing.createdAt,
        },
        scanned: candidates.length,
        skipped,
      }
    }

    skipped += 1
    recordAutopostSkip({
      productId: listing.productId,
      sku: product.sku,
      title: product.title,
      code: SHIPPING_NOT_READY_CODE,
      message: SHIPPING_NOT_READY_MESSAGE,
    })
    log("info", "wallapop_autopost_skip_shipping", {
      listingId: listing.id,
      productId: listing.productId,
      sku: product.sku,
      code: SHIPPING_NOT_READY_CODE,
    })
  }

  return { listing: null, scanned: candidates.length, skipped }
}

/** True only when timers are scheduled. */
export function isWallapopAutopostLoopScheduling(): boolean {
  return scheduling
}

function clearScheduledTick(): void {
  if (scheduleTimer != null) {
    clearTimeout(scheduleTimer)
    scheduleTimer = null
  }
  nextAutopostTickAtMs = null
}

/** Tests only — drop in-process loop flags and pending timeouts. */
export function resetWallapopAutopostLoopForTests(): void {
  scheduleGeneration += 1
  clearScheduledTick()
  started = false
  scheduling = false
}

/**
 * Fire-and-forget in-process loop. Idempotent if called twice.
 * Always schedules; each tick no-ops unless the default account has
 * `autopostEnabled` and live publish env is on.
 */
export function startWallapopAutopostLoop(): void {
  try {
    if (started) {
      log("info", "wallapop_autopost_already_started")
      return
    }

    started = true
    scheduling = true
    log("info", "wallapop_autopost_started", {
      livePublish: isAutopostLivePublishEnabled(),
    })
    void scheduleNextAsync()
  } catch (error) {
    log("error", "wallapop_autopost_start_failed", serializeError(error))
  }
}

/**
 * Drop the pending wait and start a new one from the current interval.
 * Used after PATCH interval / Start so the countdown is not leftover from
 * a previous (longer) timeout.
 */
export async function rescheduleAutopostLoop(): Promise<void> {
  if (!started || !scheduling) return
  await scheduleNextAsync()
}

async function scheduleNextAsync(): Promise<void> {
  const generation = ++scheduleGeneration
  clearScheduledTick()

  let intervalMs = DEFAULT_AUTOPOST_INTERVAL_MS
  try {
    intervalMs = await resolveAutopostIntervalMs()
  } catch (error) {
    log(
      "error",
      "wallapop_autopost_interval_resolve_failed",
      serializeError(error),
    )
  }
  if (generation !== scheduleGeneration) return

  const delayMs = autopostDelayWithJitter(intervalMs)
  nextAutopostTickAtMs = Date.now() + delayMs
  scheduleTimer = setTimeout(() => {
    if (generation !== scheduleGeneration) return
    scheduleTimer = null
    nextAutopostTickAtMs = null
    void runAutopostTick()
      .catch((error) => {
        log("error", "wallapop_autopost_tick_failed", serializeError(error))
      })
      .finally(() => {
        if (generation === scheduleGeneration) void scheduleNextAsync()
      })
  }, delayMs)
}

/**
 * One queue tick. Exported for tests — pass a mock publish so Vitest never
 * opens Chrome. Dry-run env skips before session / pick / publish.
 */
export async function runAutopostTick(
  publishProduct: typeof runProductPublish = runProductPublish,
): Promise<void> {
  const prisma = getPrisma()
  if (!prisma) {
    log("warn", "wallapop_autopost_skip_no_db")
    return
  }

  if (!isAutopostLivePublishEnabled()) {
    log("info", "wallapop_autopost_idle_until_live")
    return
  }

  if (!(await isDefaultAccountAutopostEnabled(prisma))) {
    log("info", "wallapop_autopost_idle_until_started")
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

  const accountId = await findDefaultAccountId(prisma)
  if (!accountId) {
    log("warn", "wallapop_autopost_skip_no_account")
    return
  }

  const picked = await pickNextAutopostListing(prisma, accountId)
  if (!picked.listing) {
    if (picked.skipped > 0) {
      log("info", "wallapop_autopost_idle_no_shipping_ready", {
        scanned: picked.scanned,
        skipped: picked.skipped,
      })
    } else {
      log("info", "wallapop_autopost_idle")
    }
    return
  }

  const listing = picked.listing

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
