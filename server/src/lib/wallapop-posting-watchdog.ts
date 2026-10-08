import type { PrismaClient } from "../../generated/prisma/client"

import { getPrisma } from "./db"
import { log, serializeError } from "./log"
import {
  getBrowserBusy,
  getWallapopHandle,
  isClosedPage,
  peekWorkerPage,
  type BrowserBusy,
} from "./wallapop-cdp"

/** POSTING older than this is leftover (crash / hung Chrome), not an in-flight fill. */
export const DEFAULT_POSTING_STALE_MS = 20 * 60 * 1000

/** Same SKU is re-queued this many claims, then FAILED. */
export const DEFAULT_POSTING_MAX_ATTEMPTS = 3

export type PostingStaleReason = "chrome_dead" | "timeout" | "target_closed"

export function readPostingStaleMs(): number {
  const raw = process.env.WALLAPOP_POSTING_STALE_MS
  if (raw == null || raw.trim() === "") return DEFAULT_POSTING_STALE_MS
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_POSTING_STALE_MS
  return n
}

export function readPostingMaxAttempts(): number {
  const raw = process.env.WALLAPOP_POSTING_MAX_ATTEMPTS
  if (raw == null || raw.trim() === "") return DEFAULT_POSTING_MAX_ATTEMPTS
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) return DEFAULT_POSTING_MAX_ATTEMPTS
  return n
}

export function isWallapopChromeAlive(): boolean {
  const handle = getWallapopHandle()
  if (!handle) return false
  try {
    return handle.browser.isConnected()
  } catch {
    return false
  }
}

export function isWallapopHandlePageClosed(): boolean {
  const publishPage = peekWorkerPage("publish")
  if (publishPage) return isClosedPage(publishPage)
  const handle = getWallapopHandle()
  if (!handle) return false
  return isClosedPage(handle.page)
}

/**
 * null = leave POSTING (live publish still holds Chrome).
 * chrome_dead / target_closed / timeout otherwise.
 */
export function classifyStalePostingReason(input: {
  busy: BrowserBusy
  chromeAlive: boolean
  pageClosed: boolean
}): PostingStaleReason | null {
  if (input.busy === "publish") return null
  if (!input.chromeAlive) return "chrome_dead"
  if (input.pageClosed) return "target_closed"
  return "timeout"
}

export function statusAfterStalePosting(
  postingAttempts: number,
  maxAttempts: number,
): "READY_TO_POST" | "FAILED" {
  return postingAttempts >= maxAttempts ? "FAILED" : "READY_TO_POST"
}

export type RecoverStalePostingDeps = {
  now?: Date
  busy?: BrowserBusy
  chromeAlive?: boolean
  pageClosed?: boolean
  staleMs?: number
  maxAttempts?: number
}

type StalePostingRow = {
  id: string
  productId: string
  postingAttempts: number
  product: { sku: string }
}

async function applyStalePostingRecovery(
  prisma: PrismaClient,
  row: StalePostingRow,
  reason: PostingStaleReason,
  maxAttempts: number,
): Promise<"FAILED" | "READY_TO_POST"> {
  const nextStatus = statusAfterStalePosting(row.postingAttempts, maxAttempts)
  await prisma.productListing.update({
    where: { id: row.id },
    data: { status: nextStatus, lastPublishError: reason },
  })
  if (nextStatus === "FAILED") {
    log("warn", "wallapop_posting_stale_failed", {
      listingId: row.id,
      productId: row.productId,
      sku: row.product.sku,
      reason,
      postingAttempts: row.postingAttempts,
    })
  } else {
    log("info", "wallapop_posting_stale_recovered", {
      listingId: row.id,
      productId: row.productId,
      sku: row.product.sku,
      reason,
      postingAttempts: row.postingAttempts,
    })
  }
  return nextStatus
}

export async function recoverStalePostingListings(
  prisma: PrismaClient,
  deps: RecoverStalePostingDeps = {},
): Promise<{ recovered: number; failed: number; skipped: boolean }> {
  const busy = deps.busy ?? getBrowserBusy()
  const chromeAlive = deps.chromeAlive ?? isWallapopChromeAlive()
  const pageClosed = deps.pageClosed ?? isWallapopHandlePageClosed()
  const reason = classifyStalePostingReason({ busy, chromeAlive, pageClosed })
  if (reason == null) {
    return { recovered: 0, failed: 0, skipped: true }
  }
  const staleMs = deps.staleMs ?? readPostingStaleMs()
  const maxAttempts = deps.maxAttempts ?? readPostingMaxAttempts()
  const cutoff = new Date((deps.now ?? new Date()).getTime() - staleMs)
  const stale = await prisma.productListing.findMany({
    where: { status: "POSTING", updatedAt: { lt: cutoff } },
    select: {
      id: true,
      productId: true,
      postingAttempts: true,
      product: { select: { sku: true } },
    },
  })
  let recovered = 0
  let failed = 0
  for (const row of stale) {
    const next = await applyStalePostingRecovery(prisma, row, reason, maxAttempts)
    if (next === "FAILED") failed += 1
    else recovered += 1
  }
  return { recovered, failed, skipped: false }
}

/** Boot: unstick POSTING left after a previous Chrome/API crash. */
export async function recoverStalePostingOnBoot(): Promise<void> {
  const prisma = getPrisma()
  if (!prisma) return
  try {
    const result = await recoverStalePostingListings(prisma)
    if (result.recovered > 0 || result.failed > 0) {
      log("info", "wallapop_posting_watchdog_boot", result)
    }
  } catch (error) {
    log("warn", "wallapop_posting_watchdog_boot_failed", serializeError(error))
  }
}
