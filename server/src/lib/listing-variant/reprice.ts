import type { Prisma } from "../../../generated/prisma/client"
import { duplicatePrice } from "../../../../lib/inventory/duplicate-price"

/** Not on Wallapop yet, so their price may still change. POSTING and live ads keep theirs. */
const QUEUED = ["READY_TO_POST", "PREPARING"] as const

/**
 * After an account's price ending changes: queued duplicates that already have a price
 * get the price for the new ending. Rows still without text get it when it is written.
 */
export async function repriceQueuedDuplicates(
  tx: Prisma.TransactionClient,
  accountId: string,
  priceEnding: number,
): Promise<number> {
  const rows = await tx.productListing.findMany({
    where: { accountId, status: { in: [...QUEUED] }, variantPrice: { not: null } },
    select: { id: true, variantPrice: true, product: { select: { price: true } } },
  })
  const idsByPrice = new Map<number, string[]>()
  for (const row of rows) {
    const price = duplicatePrice(Number(row.product.price.toString()), priceEnding)
    if (Number(row.variantPrice?.toString()) === price) continue
    idsByPrice.set(price, [...(idsByPrice.get(price) ?? []), row.id])
  }
  let changed = 0
  for (const [price, ids] of idsByPrice) {
    const result = await tx.productListing.updateMany({
      where: { id: { in: ids }, status: { in: [...QUEUED] } },
      data: { variantPrice: price },
    })
    changed += result.count
  }
  return changed
}
