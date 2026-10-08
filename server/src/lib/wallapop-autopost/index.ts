import type { PrismaClient } from "../../../generated/prisma/client"

import { getRecentAutopostSkips } from "../autopost-recent-skips"
import { findDefaultAccountId } from "../default-account"
import { getPrisma } from "../db"
import { log, serializeError } from "../log"
import { isBrowserPublishBusy } from "../wallapop-cdp"
import { getWallapopSessionSnapshot } from "../wallapop-session"
import { recoverStalePostingListings } from "../wallapop-posting-watchdog"
import { runProductPublish } from "../../routes/product-publish"
import {
  autopostDelayWithJitter,
  DEFAULT_AUTOPOST_INTERVAL_MS,
  isAutopostLivePublishEnabled,
  resolveAutopostInterval,
  resolveAutopostIntervalMs,
  toAutopostStatusJson,
} from "./interval"
import { pickNextAutopostListing } from "./pick"

export {
  AUTOPOST_INTERVAL_MS_MAX,
  AUTOPOST_INTERVAL_MS_MIN,
  AUTOPOST_JITTER_FRACTION,
  autopostDelayWithJitter,
  DEFAULT_AUTOPOST_INTERVAL_MS,
  isAutopostLivePublishEnabled,
  isWallapopAutopostEnabled,
  readAutopostIntervalMs,
  readAutopostIntervalMsFromEnv,
  resolveAutopostInterval,
  resolveAutopostIntervalMs,
  toAutopostStatusJson,
  type AutopostIntervalResolution,
  type AutopostIntervalSource,
} from "./interval"

export {
  AUTOPOST_PICK_BATCH,
  AUTOPOST_PICK_ORDER_BY,
  autopostEligibleListingWhere,
  findNextAutopostListing,
  pickNextAutopostListing,
} from "./pick"

let started = false
let scheduling = false
let scheduleTimer: ReturnType<typeof setTimeout> | null = null
let scheduleGeneration = 0
/** Wall clock when the in-process timer will run `runAutopostTick` (not publish finish). */
let nextAutopostTickAtMs: number | null = null

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
async function recoverStalePostingOnTick(prisma: PrismaClient): Promise<void> {
  try {
    await recoverStalePostingListings(prisma)
  } catch (error) {
    log("warn", "wallapop_posting_watchdog_tick_failed", serializeError(error))
  }
}

async function autopostTickGates(
  prisma: PrismaClient,
): Promise<string | null> {
  if (!isAutopostLivePublishEnabled()) {
    log("info", "wallapop_autopost_idle_until_live")
    return null
  }
  if (!(await isDefaultAccountAutopostEnabled(prisma))) {
    log("info", "wallapop_autopost_idle_until_started")
    return null
  }
  log("info", "wallapop_autopost_tick")
  const session = await getWallapopSessionSnapshot()
  if (session.status !== "ACTIVE") {
    log("info", "wallapop_autopost_skip_session", { status: session.status })
    return null
  }
  if (isBrowserPublishBusy()) {
    log("info", "wallapop_autopost_skip_busy", { busy: "publish" })
    return null
  }
  const accountId = await findDefaultAccountId(prisma)
  if (!accountId) {
    log("warn", "wallapop_autopost_skip_no_account")
    return null
  }
  return accountId
}

function logAutopostIdlePick(picked: {
  scanned: number
  skipped: number
}): void {
  if (picked.skipped > 0) {
    log("info", "wallapop_autopost_idle_no_shipping_ready", {
      scanned: picked.scanned,
      skipped: picked.skipped,
    })
    return
  }
  log("info", "wallapop_autopost_idle")
}

async function publishPickedAutopostListing(
  listing: { id: string; productId: string },
  publishProduct: typeof runProductPublish,
): Promise<void> {
  log("info", "wallapop_autopost_pick", {
    listingId: listing.id,
    productId: listing.productId,
  })
  const result = await publishProduct(listing.productId, { dryRun: false })
  if (!result.ok) {
    if (result.code === "PUBLISH_ABORTED") {
      log("info", "wallapop_autopost_aborted", {
        listingId: listing.id,
        productId: listing.productId,
        message: result.message,
      })
      return
    }
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

export async function runAutopostTick(
  publishProduct: typeof runProductPublish = runProductPublish,
): Promise<void> {
  const prisma = getPrisma()
  if (!prisma) {
    log("warn", "wallapop_autopost_skip_no_db")
    return
  }
  await recoverStalePostingOnTick(prisma)
  const accountId = await autopostTickGates(prisma)
  if (!accountId) return
  const picked = await pickNextAutopostListing(prisma, accountId)
  if (!picked.listing) {
    logAutopostIdlePick(picked)
    return
  }
  await publishPickedAutopostListing(picked.listing, publishProduct)
}
