import { wallapopEsItemUrlOrNull } from "../../../lib/inventory/wallapop-item-url"
import { assignChromePlaces } from "./account-chrome"
import { getPrisma } from "./db"
import { log, serializeError } from "./log"
import {
  markWallapopReservedInBrowser,
  markWallapopUnreservedInBrowser,
} from "./wallapop-reserve"

export type SiblingReserveListing = {
  accountId: string
  status: string
  externalUrl: string | null
}

export type SiblingReserveTarget = {
  accountId: string
  itemUrl: string
}

/**
 * Ads still for sale on the other accounts. The account that is already
 * reserved is left alone. Each target is reserved on Wallapop, not sold.
 */
export function siblingReserveTargets(
  listings: SiblingReserveListing[],
  sourceAccountId: string | null,
): SiblingReserveTarget[] {
  const reserved = new Set(
    listings.filter((listing) => listing.status === "RESERVED").map((listing) => listing.accountId),
  )
  if (sourceAccountId) reserved.add(sourceAccountId)
  if (reserved.size === 0) return []
  const targets: SiblingReserveTarget[] = []
  const seen = new Set<string>()
  for (const listing of listings) {
    if (reserved.has(listing.accountId) || seen.has(listing.accountId)) continue
    if (listing.status !== "ACTIVE") continue
    const itemUrl = wallapopEsItemUrlOrNull(listing.externalUrl)
    if (!itemUrl) continue
    seen.add(listing.accountId)
    targets.push({ accountId: listing.accountId, itemUrl })
  }
  return targets
}

/**
 * Reservations we still hold on the other accounts after the purchase that
 * caused them was cancelled or the ad was deleted. The selling account is
 * not included. Each target is released on Wallapop, not sold and not deleted.
 */
export function siblingUnreserveTargets(
  listings: SiblingReserveListing[],
  sourceAccountId: string | null,
): SiblingReserveTarget[] {
  const targets: SiblingReserveTarget[] = []
  const seen = new Set<string>()
  for (const listing of listings) {
    if (sourceAccountId && listing.accountId === sourceAccountId) continue
    if (listing.status !== "RESERVED" || seen.has(listing.accountId)) continue
    const itemUrl = wallapopEsItemUrlOrNull(listing.externalUrl)
    if (!itemUrl) continue
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

async function portsByAccount(): Promise<Map<string, number>> {
  const prisma = getPrisma()
  if (!prisma) return new Map()
  const accounts = await prisma.account.findMany({
    select: { id: true, chromeSlot: true },
  })
  const places = assignChromePlaces(accounts)
  const ports = new Map<string, number>()
  for (const [accountId, place] of places) ports.set(accountId, place.port)
  return ports
}

async function runSiblingReserve(
  productId: string,
  target: SiblingReserveTarget,
  port: number,
): Promise<void> {
  log("info", "wallapop_sibling_reserve_start", {
    productId,
    accountId: target.accountId,
    port,
    itemUrl: target.itemUrl,
  })
  const result = await markWallapopReservedInBrowser({
    itemUrl: target.itemUrl,
    cdpPort: port,
  })
  if (result.step !== "reserved") return
  const prisma = getPrisma()
  if (!prisma) return
  const updated = await prisma.productListing.updateMany({
    where: {
      productId,
      accountId: target.accountId,
      status: "ACTIVE",
    },
    data: { status: "RESERVED" },
  })
  log("info", "wallapop_sibling_reserve_done", {
    productId,
    accountId: target.accountId,
    already: result.already,
    updated: updated.count,
  })
}

function enqueueSibling(productId: string, target: SiblingReserveTarget, port: number): void {
  const key = `${productId}:${target.accountId}`
  if (inflight.has(key)) return
  inflight.add(key)
  log("info", "wallapop_sibling_reserve_queued", {
    productId,
    accountId: target.accountId,
    port,
  })
  enqueueOnPort(port, async () => {
    try {
      await runSiblingReserve(productId, target, port)
    } catch (error) {
      log("error", "wallapop_sibling_reserve_failed", {
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

async function enqueueProduct(
  productId: string,
  listings: SiblingReserveListing[],
  sourceAccountId: string | null,
  ports: Map<string, number>,
): Promise<void> {
  for (const target of siblingReserveTargets(listings, sourceAccountId)) {
    const port = ports.get(target.accountId)
    if (port == null) {
      log("warn", "wallapop_sibling_reserve_no_port", {
        productId,
        accountId: target.accountId,
      })
      continue
    }
    enqueueSibling(productId, target, port)
  }
}

/** After this account's reserve, reserve the same product on every other live ad. */
export async function scheduleSiblingReserved(
  productId: string,
  sourceAccountId: string,
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
  await enqueueProduct(productId, product.listings, sourceAccountId, await portsByAccount())
}

async function runSiblingUnreserve(
  productId: string,
  target: SiblingReserveTarget,
  port: number,
): Promise<void> {
  log("info", "wallapop_sibling_unreserve_start", {
    productId,
    accountId: target.accountId,
    port,
    itemUrl: target.itemUrl,
  })
  const result = await markWallapopUnreservedInBrowser({
    itemUrl: target.itemUrl,
    cdpPort: port,
  })
  if (result.step !== "active") return
  const prisma = getPrisma()
  if (!prisma) return
  const updated = await prisma.productListing.updateMany({
    where: {
      productId,
      accountId: target.accountId,
      status: "RESERVED",
    },
    data: { status: "ACTIVE" },
  })
  log("info", "wallapop_sibling_unreserve_done", {
    productId,
    accountId: target.accountId,
    already: result.already,
    updated: updated.count,
  })
}

function enqueueUnreserve(
  productId: string,
  target: SiblingReserveTarget,
  port: number,
): void {
  const key = `unreserve:${productId}:${target.accountId}`
  if (inflight.has(key)) return
  inflight.add(key)
  log("info", "wallapop_sibling_unreserve_queued", {
    productId,
    accountId: target.accountId,
    port,
  })
  enqueueOnPort(port, async () => {
    try {
      await runSiblingUnreserve(productId, target, port)
    } catch (error) {
      log("error", "wallapop_sibling_unreserve_failed", {
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

/** The purchase is gone. Release Reservado on the other accounts. */
export async function scheduleSiblingUnreserve(
  productId: string,
  sourceAccountId: string | null,
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
  for (const target of siblingUnreserveTargets(product.listings, sourceAccountId)) {
    const port = ports.get(target.accountId)
    if (port == null) {
      log("warn", "wallapop_sibling_unreserve_no_port", {
        productId,
        accountId: target.accountId,
      })
      continue
    }
    enqueueUnreserve(productId, target, port)
  }
}

/** One account is already RESERVED and another live ad is still for sale. */
export async function scheduleOpenSiblingAdsForReservedProducts(): Promise<void> {
  const prisma = getPrisma()
  if (!prisma) return
  const products = await prisma.product.findMany({
    where: {
      listings: { some: { status: "RESERVED" } },
    },
    select: {
      id: true,
      listings: {
        select: { accountId: true, status: true, externalUrl: true },
      },
    },
  })
  const ports = await portsByAccount()
  for (const product of products) {
    await enqueueProduct(product.id, product.listings, null, ports)
  }
}
