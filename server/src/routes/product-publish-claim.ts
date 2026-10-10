import type { PrismaClient } from "../../generated/prisma/client"

import { listingWithoutPublicItemUrlWhere } from "../../../lib/inventory/wallapop-item-url"
import { log } from "../lib/log"
import type { PrismaDb } from "./product-publish-prepare"

export type PublishClaimFlags = {
  postedOnWallapop: boolean
  clickedPublicar: boolean
}

/** Atomic READY_TO_POST → POSTING for (product, account) without a public item URL. */
export async function claimListingForPublish(
  prisma: PrismaClient,
  productId: string,
  accountId: string,
): Promise<boolean> {
  const result = await prisma.productListing.updateMany({
    where: {
      productId,
      accountId,
      status: "READY_TO_POST",
      ...listingWithoutPublicItemUrlWhere,
    },
    data: {
      status: "POSTING",
      externalUrl: null,
      postingAttempts: { increment: 1 },
      lastPublishError: null,
    },
  })
  return result.count > 0
}

/** Revert POSTING → READY_TO_POST only. Never touches ACTIVE / RESERVED. */
export async function revertPublishClaim(
  prisma: PrismaClient,
  productId: string,
  accountId: string,
): Promise<void> {
  await prisma.productListing.updateMany({
    where: {
      productId,
      accountId,
      status: "POSTING",
    },
    data: { status: "READY_TO_POST" },
  })
}

/**
 * Revert POSTING → READY_TO_POST only when we claimed and Publicar was never clicked.
 * `postedOnWallapop` is true after D9 verified the published catalog (or /item/).
 * `clickedPublicar` / `keepClaim`: click ran but verify failed — stay POSTING, not ACTIVE.
 */
export function shouldRevertPublishClaim(
  claimed: boolean,
  postedOnWallapop: boolean,
  clickedPublicar = false,
): boolean {
  return claimed && !postedOnWallapop && !clickedPublicar
}

export async function revertPublishClaimIfNeeded(input: {
  prisma: PrismaDb
  productId: string
  accountId: string
  claimed: boolean
  flags: PublishClaimFlags
}): Promise<void> {
  const { prisma, productId, accountId, claimed, flags } = input
  if (!shouldRevertPublishClaim(claimed, flags.postedOnWallapop, flags.clickedPublicar)) {
    return
  }
  try {
    await revertPublishClaim(prisma, productId, accountId)
  } catch (revertError) {
    log("error", "wallapop_publish_claim_revert_failed", {
      productId,
      accountId,
      message:
        revertError instanceof Error ? revertError.message : String(revertError),
    })
  }
}
