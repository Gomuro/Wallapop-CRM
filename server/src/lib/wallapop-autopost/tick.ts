import type { PrismaClient } from "../../../generated/prisma/client"

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
import { isAutopostLivePublishEnabled } from "./interval"
import { pickNextAutopostListing, queueHeldForReserveWhere } from "./pick"
import { isRestrictionSuspected } from "../wallapop-restriction"
import { isDefaultAccountAutopostEnabled } from "./status"

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
  if (await isRestrictionSuspected(prisma, accountId)) {
    log("warn", "wallapop_autopost_skip_restriction", { accountId })
    return null
  }
  return accountId
}

/** Queue rows are still there, but another account of the product is reserved. */
async function queueWaitingOnReserve(
  prisma: PrismaClient,
  accountId: string,
): Promise<boolean> {
  const waiting = await prisma.productListing.count({
    where: queueHeldForReserveWhere(accountId),
  })
  if (waiting === 0) return false
  log("info", "wallapop_autopost_wait_reserved", { accountId, waiting })
  return true
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

/**
 * One queue tick. Exported for tests — pass a mock publish so Vitest never
 * opens Chrome. Dry-run env skips before session / pick / publish.
 */
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
      if (await queueWaitingOnReserve(prisma, accountId)) return true
      log("info", "wallapop_autopost_paused_empty_queue")
      return false
    }
    return true
  }
  await publishPickedAutopostListing(picked.listing, publishProduct)
  return true
}

async function skipAccountAutopost(
  prisma: PrismaClient,
  accountId: string,
): Promise<boolean> {
  if (!isAutopostLivePublishEnabled()) return true
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { autopostEnabled: true, restrictionSuspectedAt: true },
  })
  if (!account?.autopostEnabled) return true
  if (account.restrictionSuspectedAt) {
    log("warn", "wallapop_autopost_skip_restriction", { accountId })
    return true
  }
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
  return false
}

async function publishAccountAutopostListing(
  accountId: string,
  listing: { id: string; productId: string },
): Promise<void> {
  log("info", "wallapop_autopost_pick", {
    accountId,
    listingId: listing.id,
    productId: listing.productId,
  })
  const result = await runProductPublish(listing.productId, {
    dryRun: false,
    accountId,
  })
  if (!result.ok) {
    log("warn", "wallapop_autopost_publish_failed", {
      accountId,
      listingId: listing.id,
      code: result.code,
      message: result.message,
    })
  }
}

export async function runAccountAutopostTick(accountId: string): Promise<boolean> {
  const prisma = getPrisma()
  if (!prisma) return false
  await recoverStalePostingOnTick(prisma)
  if (await skipAccountAutopost(prisma, accountId)) return true
  const picked = await pickNextAutopostListing(prisma, accountId)
  if (!picked.listing) {
    logAutopostIdlePick(picked)
    if (picked.scanned !== 0) return true
    return queueWaitingOnReserve(prisma, accountId)
  }
  await publishAccountAutopostListing(accountId, picked.listing)
  return true
}
