import { findDefaultAccountId } from "./default-account"
import { getPrisma } from "./db"

type PrismaDb = NonNullable<ReturnType<typeof getPrisma>>

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
  body: { soldPrice?: number },
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
      },
    })
    await tx.productListing.updateMany({
      where: { productId: id },
      data: { status: "DEACTIVATED" },
    })
    return { kind: "ok" }
  })
}

/**
 * After a return: same product leaves SOLD and the default listing goes back
 * to READY_TO_POST with no /item/ URL. Does not create a second warehouse row.
 */
export async function requeueSoldProductAfterReturn(
  prisma: PrismaDb,
  productId: string,
): Promise<DevolucionRequeueResult> {
  const accountId = await findDefaultAccountId(prisma)
  if (!accountId) return { kind: "no_default_account" }
  return prisma.$transaction(async (tx) => {
    const existing = await tx.product.findUnique({
      where: { id: productId },
      select: { id: true, status: true },
    })
    if (!existing) return { kind: "not_found" }
    if (existing.status !== "SOLD") return { kind: "not_sold" }
    await tx.product.update({
      where: { id: productId },
      data: { status: "ACTIVE", soldAt: null, soldPrice: null },
    })
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
    if (listing.count === 0) {
      await tx.productListing.create({
        data: {
          productId,
          accountId,
          status: "READY_TO_POST",
          externalUrl: null,
        },
      })
    }
    return { kind: "ok" }
  })
}
