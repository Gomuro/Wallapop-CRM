import type { Prisma, PrismaClient } from "../../generated/prisma/client"

import { log } from "./log"

type Db = Pick<PrismaClient, "productListing">

/** Shown on the card, so the operator sees why autopost skipped the product. */
export function attemptsExhaustedMessage(maxAttempts: number): string {
  return `Pausado tras ${maxAttempts} intentos fallidos seguidos. Revisa el registro del servidor y pulsa «Poner en cola» para reintentar.`
}

/** Queue rows that already used up their attempts. Autopost only picks READY_TO_POST. */
export function exhaustedAttemptsWhere(
  maxAttempts: number,
): Prisma.ProductListingWhereInput {
  return { status: "READY_TO_POST", postingAttempts: { gte: maxAttempts } }
}

/**
 * Move queue rows with too many failed attempts to FAILED and keep the reason.
 * The warehouse product stays. Returns how many rows were paused.
 */
export async function failExhaustedListings(
  prisma: Db,
  maxAttempts: number,
): Promise<number> {
  const paused = await prisma.productListing.updateManyAndReturn({
    where: exhaustedAttemptsWhere(maxAttempts),
    data: {
      status: "FAILED",
      lastPublishError: attemptsExhaustedMessage(maxAttempts),
    },
    select: { id: true, productId: true, accountId: true, postingAttempts: true },
  })
  for (const row of paused) {
    log("warn", "wallapop_listing_attempts_exhausted", {
      listingId: row.id,
      productId: row.productId,
      accountId: row.accountId,
      postingAttempts: row.postingAttempts,
      maxAttempts,
    })
  }
  return paused.length
}
