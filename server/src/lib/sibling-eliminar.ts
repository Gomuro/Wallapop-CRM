import { wallapopEsItemUrlOrNull } from "../../../lib/inventory/wallapop-item-url"
import { assignChromePlaces } from "./account-chrome"
import { getPrisma } from "./db"
import { log, serializeError } from "./log"
import { markWallapopSoldInBrowser } from "./wallapop-sold"

const LIVE_LISTING = new Set(["ACTIVE", "RESERVED"])

export type SiblingListing = {
  accountId: string
  status: string
  externalUrl: string | null
}

export type SiblingSoldTarget = {
  accountId: string
  itemUrl: string
}

/**
 * Live ads on the other accounts. The account that just sold is left alone.
 * Those ads are marked sold too. They are not deleted.
 */
export function siblingSoldTargets(
  listings: SiblingListing[],
  soldAccountId: string | null,
): SiblingSoldTarget[] {
  const targets: SiblingSoldTarget[] = []
  const seen = new Set<string>()
  for (const listing of listings) {
    if (soldAccountId && listing.accountId === soldAccountId) continue
    if (!LIVE_LISTING.has(listing.status)) continue
    const itemUrl = wallapopEsItemUrlOrNull(listing.externalUrl)
    if (!itemUrl || seen.has(listing.accountId)) continue
    seen.add(listing.accountId)
    targets.push({ accountId: listing.accountId, itemUrl })
  }
  return targets
}

const inflight = new Set<string>()
const tails = new Map<number, Promise<void>>()

function enqueueOnPort(port: number, run: () => Promise<void>): void {
  const prev = tails.get(port) ?? Promise.resolve()
  const next = prev.then(run, run)
  tails.set(
    port,
    next.then(
      () => {},
      () => {},
    ),
  )
}

async function runSiblingSold(
  productId: string,
  target: SiblingSoldTarget,
  port: number,
): Promise<void> {
  log("info", "wallapop_sibling_sold_start", {
    productId,
    accountId: target.accountId,
    port,
    itemUrl: target.itemUrl,
  })
  const result = await markWallapopSoldInBrowser({
    itemUrl: target.itemUrl,
    dryRun: false,
    cdpPort: port,
    matchAnywhere: true,
  })
  if (result.dryRun || result.step !== "sold") {
    log("warn", "wallapop_sibling_sold_not_done", {
      productId,
      accountId: target.accountId,
      step: result.step,
      dryRun: result.dryRun,
    })
    return
  }
  const prisma = getPrisma()
  if (!prisma) return
  const updated = await prisma.productListing.updateMany({
    where: { productId, accountId: target.accountId },
    data: { status: "DEACTIVATED" },
  })
  log("info", "wallapop_sibling_sold_done", {
    productId,
    accountId: target.accountId,
    updated: updated.count,
  })
}

function enqueueSibling(
  productId: string,
  target: SiblingSoldTarget,
  port: number,
): void {
  const key = `${productId}:${target.accountId}`
  if (inflight.has(key)) return
  inflight.add(key)
  log("info", "wallapop_sibling_sold_queued", {
    productId,
    accountId: target.accountId,
    port,
  })
  enqueueOnPort(port, async () => {
    try {
      await runSiblingSold(productId, target, port)
    } catch (error) {
      log("error", "wallapop_sibling_sold_failed", {
        productId,
        accountId: target.accountId,
        port,
        err: serializeError(error),
      })
    } finally {
      inflight.delete(key)
    }
  })
}

async function portsByAccount(): Promise<Map<string, number>> {
  const prisma = getPrisma()
  if (!prisma) return new Map()
  const accounts = await prisma.account.findMany({
    select: { id: true, isDefault: true, createdAt: true },
  })
  const places = assignChromePlaces(accounts)
  const ports = new Map<string, number>()
  for (const [accountId, place] of places) ports.set(accountId, place.port)
  return ports
}

/** After this account's sale, mark the same product sold on every other live ad. */
export async function scheduleSiblingSold(
  productId: string,
  soldAccountId: string,
): Promise<void> {
  const prisma = getPrisma()
  if (!prisma) return
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      listings: {
        select: { accountId: true, status: true, externalUrl: true },
      },
    },
  })
  if (!product) return
  const ports = await portsByAccount()
  for (const target of siblingSoldTargets(product.listings, soldAccountId)) {
    const port = ports.get(target.accountId)
    if (port == null) {
      log("warn", "wallapop_sibling_sold_no_port", {
        productId,
        accountId: target.accountId,
      })
      continue
    }
    enqueueSibling(productId, target, port)
  }
}

/**
 * Sold products whose other accounts still have a live /item/.
 * A sale recorded before this follow-up, or a failed click, is picked up here.
 * The ad stays on Wallapop. It is marked sold, not deleted.
 */
export async function scheduleOpenSiblingAdsForSoldProducts(): Promise<void> {
  const prisma = getPrisma()
  if (!prisma) return
  const products = await prisma.product.findMany({
    where: {
      status: "SOLD",
      listings: { some: { status: { in: ["ACTIVE", "RESERVED"] } } },
    },
    select: {
      id: true,
      soldAccountId: true,
      listings: {
        select: { accountId: true, status: true, externalUrl: true },
      },
    },
  })
  const ports = await portsByAccount()
  for (const product of products) {
    for (const target of siblingSoldTargets(
      product.listings,
      product.soldAccountId,
    )) {
      const port = ports.get(target.accountId)
      if (port == null) continue
      enqueueSibling(product.id, target, port)
    }
  }
}
