import type { Prisma } from "../../generated/prisma/client"

import { findDefaultAccountId } from "./default-account"
import { getPrisma } from "./db"
import { log } from "./log"

/** Not on Wallapop yet. A sale takes these off the queue. Live ads are marked sold and keep their URL. */
const QUEUE_LISTING_STATUSES = ["READY_TO_POST", "PREPARING", "POSTING"] as const

const OFF_QUEUE_DATA = {
  status: "DEACTIVATED" as const,
  externalUrl: null,
  externalItemId: null,
  postingAttempts: 0,
  lastPublishError: null,
}

export function siblingQueueOffWhere(
  productId: string,
  soldAccountId: string | null,
): Prisma.ProductListingWhereInput {
  return {
    productId,
    status: { in: [...QUEUE_LISTING_STATUSES] },
    ...(soldAccountId ? { accountId: { not: soldAccountId } } : {}),
  }
}

type PrismaDb = NonNullable<ReturnType<typeof getPrisma>>
type SoldTx = Prisma.TransactionClient

export type SoldTxResult =
  | { kind: "not_found" }
  | { kind: "already_sold" }
  | { kind: "ok" }

export type DevolucionRequeueResult =
  | { kind: "not_found" }
  | { kind: "not_sold" }
  | { kind: "no_default_account" }
  | { kind: "ok" }

export async function markProductSoldTx(
  prisma: PrismaDb,
  id: string,
  body: { soldPrice?: number; accountId: string },
): Promise<SoldTxResult> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.product.findUnique({
      where: { id },
      select: { id: true, status: true, price: true, soldAccountId: true },
    })
    if (!existing) return { kind: "not_found" }
    if (existing.status === "SOLD") {
      await pullSiblingQueueInTx(tx, id, existing.soldAccountId)
      return { kind: "already_sold" }
    }
    await tx.product.update({
      where: { id },
      data: {
        status: "SOLD",
        soldAt: new Date(),
        soldPrice: body.soldPrice ?? existing.price,
        soldAccountId: body.accountId,
      },
    })
    await tx.productListing.updateMany({
      where: { productId: id, accountId: body.accountId },
      data: { status: "DEACTIVATED" },
    })
    await pullSiblingQueueInTx(tx, id, body.accountId)
    return { kind: "ok" }
  })
}

async function pullSiblingQueueInTx(
  tx: SoldTx,
  productId: string,
  soldAccountId: string | null,
): Promise<void> {
  await tx.productListing.updateMany({
    where: siblingQueueOffWhere(productId, soldAccountId),
    data: OFF_QUEUE_DATA,
  })
}

/** Sold rows still sitting in another account's queue. Monitor picks these up. */
export async function pullQueuedListingsForSoldProducts(): Promise<number> {
  const prisma = getPrisma()
  if (!prisma) return 0
  const products = await prisma.product.findMany({
    where: {
      status: "SOLD",
      listings: { some: { status: { in: [...QUEUE_LISTING_STATUSES] } } },
    },
    select: { id: true, soldAccountId: true },
  })
  let cleared = 0
  for (const product of products) {
    const result = await prisma.productListing.updateMany({
      where: siblingQueueOffWhere(product.id, product.soldAccountId),
      data: OFF_QUEUE_DATA,
    })
    cleared += result.count
  }
  if (cleared > 0) {
    log("info", "wallapop_sold_queue_cleared", { count: cleared })
  }
  return cleared
}

async function recordedOrDefaultAccountId(
  prisma: PrismaDb,
  productId: string,
): Promise<string | null> {
  const preview = await prisma.product.findUnique({
    where: { id: productId },
    select: { soldAccountId: true },
  })
  if (preview?.soldAccountId) return preview.soldAccountId
  return findDefaultAccountId(prisma)
}

async function requeueSellerListing(
  tx: SoldTx,
  productId: string,
  accountId: string,
): Promise<void> {
  const listing = await tx.productListing.updateMany({
    where: { productId, accountId },
    data: {
      status: "READY_TO_POST",
      externalUrl: null,
      externalItemId: null,
      postingAttempts: 0,
      lastPublishError: null,
    },
  })
  if (listing.count > 0) return
  await tx.productListing.create({
    data: {
      productId,
      accountId,
      status: "READY_TO_POST",
      externalUrl: null,
    },
  })
}

async function clearSoldWarehouse(
  tx: SoldTx,
  productId: string,
): Promise<string | null> {
  const existing = await tx.product.findUnique({
    where: { id: productId },
    select: { status: true, soldAccountId: true },
  })
  if (!existing || existing.status !== "SOLD" || !existing.soldAccountId) return null
  await tx.product.update({
    where: { id: productId },
    data: {
      status: "ACTIVE",
      soldAt: null,
      soldPrice: null,
      soldAccountId: null,
    },
  })
  return existing.soldAccountId
}

/**
 * The sold ad was deleted. Warehouse goes back to ACTIVE. That account stays
 * Desactivado and loses the URL. Other accounts are left for the caller:
 * a sibling reservation is released, a sibling that was already taken down
 * is not put back in the queue.
 */
export async function revertRemovedSale(
  prisma: PrismaDb,
  productId: string,
): Promise<boolean> {
  const accountId = await prisma.$transaction(async (tx) => {
    const soldAccountId = await clearSoldWarehouse(tx, productId)
    if (!soldAccountId) return null
    await tx.productListing.updateMany({
      where: { productId, accountId: soldAccountId },
      data: {
        status: "DEACTIVATED",
        externalUrl: null,
        externalItemId: null,
      },
    })
    return soldAccountId
  })
  return accountId != null
}

/**
 * The purchase was cancelled and the same /item/ is in En venta again.
 * Warehouse goes back to ACTIVE and that listing is live. The URL stays.
 */
export async function revertRelistedSale(
  prisma: PrismaDb,
  productId: string,
): Promise<boolean> {
  const accountId = await prisma.$transaction(async (tx) => {
    const soldAccountId = await clearSoldWarehouse(tx, productId)
    if (!soldAccountId) return null
    await tx.productListing.updateMany({
      where: { productId, accountId: soldAccountId, status: "DEACTIVATED" },
      data: { status: "ACTIVE" },
    })
    return soldAccountId
  })
  return accountId != null
}

/**
 * After a return the warehouse is ACTIVE again. The selling account goes
 * back to the queue. Every other listing already taken down (DEACTIVATED)
 * goes back too, so a sibling Eliminar is republished. A listing that is
 * still live stays as it is. Accounts with no row are not created, except
 * the selling account when it has none. Does not create a second warehouse row.
 */
export async function requeueSoldProductAfterReturn(
  prisma: PrismaDb,
  productId: string,
): Promise<DevolucionRequeueResult> {
  const fallbackAccountId = await recordedOrDefaultAccountId(prisma, productId)
  return prisma.$transaction(async (tx) => {
    const existing = await tx.product.findUnique({
      where: { id: productId },
      select: { id: true, status: true, soldAccountId: true },
    })
    if (!existing) return { kind: "not_found" }
    if (existing.status !== "SOLD") return { kind: "not_sold" }
    const accountId = existing.soldAccountId ?? fallbackAccountId
    if (!accountId) return { kind: "no_default_account" }
    await tx.product.update({
      where: { id: productId },
      data: {
        status: "ACTIVE",
        soldAt: null,
        soldPrice: null,
        soldAccountId: null,
      },
    })
    await requeueSellerListing(tx, productId, accountId)
    await tx.productListing.updateMany({
      where: { productId, status: "DEACTIVATED" },
      data: {
        status: "READY_TO_POST",
        externalUrl: null,
        externalItemId: null,
        postingAttempts: 0,
        lastPublishError: null,
      },
    })
    return { kind: "ok" }
  })
}
