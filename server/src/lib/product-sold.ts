import { getPrisma } from "./db"

type PrismaDb = NonNullable<ReturnType<typeof getPrisma>>

export type SoldTxResult =
  | { kind: "not_found" }
  | { kind: "already_sold" }
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
