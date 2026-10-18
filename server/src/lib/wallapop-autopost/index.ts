import type { PrismaClient } from "../../../generated/prisma/client"

import { getRecentAutopostSkips } from "../autopost-recent-skips"
import { chromePortForAccount } from "../account-chrome"
import { findDefaultAccountId } from "../default-account"
import { getPrisma } from "../db"
import { log, serializeError } from "../log"
import { isBrowserPublishBusy } from "../wallapop-cdp"
import {
  getWallapopSessionSnapshot,
  peekWallapopSession,
} from "../wallapop-session"
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
/** True from the moment a tick starts until it finishes, including the Chrome upload. */
let autopostTickRunning = false

type AccountAutopostDesk = {
  generation: number
  timer: ReturnType<typeof setTimeout> | null
  nextAt: number | null
  running: boolean
}

const accountAutopost = new Map<string, AccountAutopostDesk>()

function extraDesk(accountId: string): AccountAutopostDesk {
  let row = accountAutopost.get(accountId)
  if (!row) {
    row = { generation: 0, timer: null, nextAt: null, running: false }
    accountAutopost.set(accountId, row)
  }
  return row
}

function accountNextTickAt(accountId: string): string | null {
  const nextAt = extraDesk(accountId).nextAt
  if (nextAt == null) return null
  return new Date(nextAt).toISOString()
}

/** ISO timestamp of the next scheduled queue tick, or null if the loop is not scheduling. */
export function getNextAutopostTickAt(): string | null {
  if (nextAutopostTickAtMs == null) return null
  return new Date(nextAutopostTickAtMs).toISOString()
}

export function isAutopostTickRunning(): boolean {
  return autopostTickRunning
}

export async function loadAutopostStatus(
  prisma: PrismaClient,
  accountId?: string,
) {
  const account = accountId
    ? await prisma.account.findUnique({
        where: { id: accountId },
        select: { id: true, isDefault: true, autopostEnabled: true },
      })
    : await prisma.account.findFirst({
        where: { isDefault: true },
        select: { id: true, isDefault: true, autopostEnabled: true },
      })
  const resolution = await resolveAutopostInterval(prisma, account?.id)
  const last = account
    ? await prisma.productListing.findFirst({
    where: {
      accountId: account.id,
      lastPostedAt: { not: null },
    },
    orderBy: { lastPostedAt: "desc" },
    select: {
      lastPostedAt: true,
      product: { select: { title: true } },
    },
  })
    : null
  const enabled = account?.autopostEnabled === true
  const readyToPostCount = account
    ? await prisma.productListing.count({
        where: { status: "READY_TO_POST", accountId: account.id },
      })
    : 0
  const nextTickAt = !enabled
    ? null
    : account?.isDefault === false
      ? accountNextTickAt(account.id)
      : getNextAutopostTickAt()
  const publishing =
    enabled &&
    (account?.isDefault === false
      ? extraDesk(account.id).running
      : autopostTickRunning)
  return toAutopostStatusJson(resolution, {
    enabled,
    lastPublication:
      last?.lastPostedAt != null
        ? { at: last.lastPostedAt.toISOString(), title: last.product.title }
        : null,
    nextTickAt,
    publishing,
    readyToPostCount,
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
  autopostTickRunning = false
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
    void scheduleEnabledAccountAutopost()
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
  try {
    if (!(await isDefaultAccountAutopostEnabled())) return
  } catch {
    // Keep scheduling when the enabled probe fails (tests / brief DB blip).
  }
  await scheduleNextAsync()
}

/** Stop the 1-minute queue timer (empty cola or Detener). Start / new READY_TO_POST call reschedule. */
export function pauseAutopostSchedule(): void {
  scheduleGeneration += 1
  clearScheduledTick()
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
    autopostTickRunning = true
    void runAutopostTick()
      .then(async (keepGoing) => {
        if (keepGoing && generation === scheduleGeneration) {
          await scheduleNextAsync()
          return
        }
        if (!keepGoing && generation === scheduleGeneration) {
          log("info", "wallapop_autopost_loop_stopped", {
            reason: "empty_queue",
          })
        }
      })
      .catch((error) => {
        log("error", "wallapop_autopost_tick_failed", serializeError(error))
      })
      .finally(() => {
        autopostTickRunning = false
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
): Promise<boolean> {
  const prisma = getPrisma()
  if (!prisma) {
    log("warn", "wallapop_autopost_skip_no_db")
    return false
  }
  await recoverStalePostingOnTick(prisma)
  const accountId = await autopostTickGates(prisma)
  if (!accountId) return true
  const picked = await pickNextAutopostListing(prisma, accountId)
  if (!picked.listing) {
    logAutopostIdlePick(picked)
    if (picked.scanned === 0) {
      log("info", "wallapop_autopost_paused_empty_queue")
      return false
    }
    return true
  }
  await publishPickedAutopostListing(picked.listing, publishProduct)
  return true
}

async function scheduleEnabledAccountAutopost(): Promise<void> {
  const prisma = getPrisma()
  if (!prisma) return
  const rows = await prisma.account.findMany({
    where: { isDefault: false, autopostEnabled: true },
    select: { id: true },
  })
  for (const row of rows) {
    await scheduleAccountAutopost(row.id)
  }
}

export function pauseAccountAutopost(accountId: string): void {
  const desk = accountAutopost.get(accountId)
  if (!desk) return
  desk.generation += 1
  if (desk.timer != null) clearTimeout(desk.timer)
  desk.timer = null
  desk.nextAt = null
}

export async function scheduleAccountAutopost(accountId: string): Promise<void> {
  const prisma = getPrisma()
  if (!prisma) return
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { isDefault: true, autopostEnabled: true },
  })
  if (!account || account.isDefault) {
    await rescheduleAutopostLoop()
    return
  }
  if (!account.autopostEnabled) return
  const desk = extraDesk(accountId)
  const generation = ++desk.generation
  if (desk.timer != null) clearTimeout(desk.timer)
  const resolution = await resolveAutopostInterval(prisma, accountId)
  const delayMs = autopostDelayWithJitter(resolution.effectiveIntervalMs)
  desk.nextAt = Date.now() + delayMs
  desk.timer = setTimeout(() => {
    if (generation !== desk.generation) return
    desk.timer = null
    desk.nextAt = null
    desk.running = true
    void runAccountAutopostTick(accountId)
      .then(async (keepGoing) => {
        if (keepGoing && generation === desk.generation) {
          await scheduleAccountAutopost(accountId)
        }
      })
      .catch((error) => {
        log("error", "wallapop_autopost_tick_failed", serializeError(error))
      })
      .finally(() => {
        desk.running = false
      })
  }, delayMs)
}

async function runAccountAutopostTick(accountId: string): Promise<boolean> {
  const prisma = getPrisma()
  if (!prisma) return false
  await recoverStalePostingOnTick(prisma)
  if (!isAutopostLivePublishEnabled()) return true
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { autopostEnabled: true },
  })
  if (!account?.autopostEnabled) return true
  if (peekWallapopSession(accountId).status !== "ACTIVE") {
    log("info", "wallapop_autopost_skip_session", {
      accountId,
      status: peekWallapopSession(accountId).status,
    })
    return true
  }
  const port = await chromePortForAccount(accountId)
  if (isBrowserPublishBusy(port)) {
    log("info", "wallapop_autopost_skip_busy", { accountId, busy: "publish" })
    return true
  }
  const picked = await pickNextAutopostListing(prisma, accountId)
  if (!picked.listing) {
    logAutopostIdlePick(picked)
    return picked.scanned !== 0
  }
  log("info", "wallapop_autopost_pick", {
    accountId,
    listingId: picked.listing.id,
    productId: picked.listing.productId,
  })
  const result = await runProductPublish(picked.listing.productId, {
    dryRun: false,
    accountId,
  })
  if (!result.ok) {
    log("warn", "wallapop_autopost_publish_failed", {
      accountId,
      listingId: picked.listing.id,
      code: result.code,
      message: result.message,
    })
  }
  return true
}
