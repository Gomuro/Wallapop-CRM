import type { Prisma } from "../../generated/prisma/client"

import { findDefaultAccountId } from "./default-account"
import { getPrisma } from "./db"

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
      select: { id: true, status: true, price: true },
    })
    if (!existing) return { kind: "not_found" }
    if (existing.status === "SOLD") return { kind: "already_sold" }
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
    return { kind: "ok" }
  })
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
