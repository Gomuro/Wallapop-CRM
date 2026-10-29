import type { PrismaClient } from "../../../generated/prisma/client"
import { sameCents } from "../../../../lib/inventory/duplicate-price"
import { getPrisma } from "../db"
import { log, serializeError } from "../log"
import { scheduleAccountAutopost } from "../wallapop-autopost"
import { DUPLICATE_SAME_PRICE_MESSAGE } from "./publish-text"
import { buildListingVariant, variantBasis, type VariantOutcome } from "./store"

const TICK_MS = 5 * 60_000
const BATCH = 10
/** Minutes until the next try after the 1st, 2nd, 3rd, 4th failure; then every 4 h, never giving up. */
const RETRY_MINUTES = [10, 30, 60, 120]
const LAST_RETRY_MINUTES = 240

export function variantRetryDelayMs(failures: number): number {
  const minutes = RETRY_MINUTES[failures - 1] ?? LAST_RETRY_MINUTES
  return minutes * 60_000
}

type PendingListing = { productId: string; accountId: string; status: string; variantAttempts: number }

/** Text ready: into the queue, unless the duplicate would cost exactly the original. */
async function promotionFor(prisma: PrismaClient, productId: string, variantPrice: number) {
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { price: true } })
  if (product && sameCents(variantPrice, Number(product.price.toString()))) {
    log("warn", "listing_variant_same_price", { productId, variantPrice })
    return { status: "FAILED" as const, lastPublishError: DUPLICATE_SAME_PRICE_MESSAGE }
  }
  return { status: "READY_TO_POST" as const }
}

/**
 * Generate and save the duplicate text for one listing. A PREPARING listing moves to
 * READY_TO_POST on success; on failure it stays and gets its next try time.
 */
export async function writeListingVariant(
  prisma: PrismaClient,
  listing: PendingListing,
  options: { regenerate?: boolean; now?: Date } = {},
): Promise<VariantOutcome> {
  const { productId, accountId } = listing
  const outcome = await buildListingVariant(prisma, productId, accountId, options)
  const where = { productId, accountId }
  if (outcome.ok) {
    if (!outcome.data) return outcome
    const promote = listing.status === "PREPARING" ? await promotionFor(prisma, productId, outcome.data.variantPrice) : {}
    await prisma.productListing.updateMany({
      where,
      data: { ...outcome.data, ...promote, variantAttempts: 0, variantNextAttemptAt: null },
    })
    return outcome
  }
  const failures = listing.variantAttempts + 1
  const next = new Date((options.now ?? new Date()).getTime() + variantRetryDelayMs(failures))
  await prisma.productListing.updateMany({
    where,
    data: { variantError: outcome.error, variantAttempts: failures, variantNextAttemptAt: next },
  })
  log("warn", "listing_variant_failed", { productId, accountId, failures, next, error: outcome.error })
  return outcome
}

/** PREPARING duplicates whose try is due, oldest first. A sold or inactive product waits. */
export async function processPendingVariants(
  prisma: PrismaClient,
  now = new Date(),
  limit = BATCH,
): Promise<{ written: number; failed: number }> {
  const due = await prisma.productListing.findMany({
    where: {
      status: "PREPARING",
      product: { status: "ACTIVE" },
      OR: [{ variantNextAttemptAt: null }, { variantNextAttemptAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { productId: true, accountId: true, status: true, variantAttempts: true },
  })
  let written = 0
  let failed = 0
  for (const listing of due) {
    const outcome = await writeListingVariant(prisma, listing, { now })
    if (!outcome.ok) {
      failed += 1
      continue
    }
    written += 1
    await scheduleAccountAutopost(listing.accountId)
  }
  return { written, failed }
}

/**
 * After a product edit: queued duplicates whose AI text was written from the old title,
 * description or brand go back to PREPARING. Manual texts and live ads are left alone.
 */
export async function prepareStaleDuplicates(prisma: PrismaClient, productId: string): Promise<number> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { title: true, description: true, brand: true },
  })
  if (!product) return 0
  const result = await prisma.productListing.updateMany({
    where: {
      productId,
      status: "READY_TO_POST",
      account: { isDefault: false },
      OR: [{ variantSource: null }, { variantSource: "ai", NOT: { variantBasis: variantBasis(product) } }],
    },
    data: { status: "PREPARING", variantAttempts: 0, variantNextAttemptAt: null },
  })
  if (result.count) kickListingVariantWorker()
  return result.count
}

const loop = { started: false, running: false, again: false, timer: null as NodeJS.Timeout | null }

async function runOnce(): Promise<void> {
  const prisma = getPrisma()
  if (!prisma) return
  if (loop.running) {
    loop.again = true
    return
  }
  loop.running = true
  try {
    const result = await processPendingVariants(prisma)
    if (result.written || result.failed) log("info", "listing_variant_tick", result)
  } catch (error) {
    log("error", "listing_variant_tick_failed", serializeError(error))
  } finally {
    loop.running = false
  }
  if (loop.again) {
    loop.again = false
    await runOnce()
  }
}

function scheduleNext(delayMs: number): void {
  if (loop.timer) clearTimeout(loop.timer)
  loop.timer = setTimeout(() => {
    void runOnce().finally(() => scheduleNext(TICK_MS))
  }, delayMs)
}

/** Background writer for duplicate texts: every 5 minutes, plus right after a kick. */
export function startListingVariantWorker(): void {
  if (loop.started) return
  loop.started = true
  log("info", "listing_variant_worker_started", { tickMs: TICK_MS })
  scheduleNext(5_000)
}

/** A duplicate was just queued: try its text now instead of at the next tick. */
export function kickListingVariantWorker(): void {
  if (!loop.started) return
  void runOnce()
}
