import type { Prisma, PrismaClient } from "../../../generated/prisma/client"

import { listingWithoutPublicItemUrlWhere } from "../../../../lib/inventory/wallapop-item-url"
import {
  isShippingPublishReady,
  SHIPPING_NOT_READY_CODE,
  SHIPPING_NOT_READY_MESSAGE,
} from "../../../../lib/inventory/shipping-for-publish"
import { recordAutopostSkip } from "../autopost-recent-skips"
import { log } from "../log"

/**
 * Eligible queue row on the default account.
 * Only `READY_TO_POST` — never POSTING / ACTIVE / RESERVED / DEACTIVATED / FAILED.
 * Stale POSTING is recovered by the posting watchdog before pick.
 * A leftover upload/home URL is not a published item — still eligible.
 */
export function autopostEligibleListingWhere(
  accountId: string,
): Prisma.ProductListingWhereInput {
  return {
    accountId,
    status: "READY_TO_POST",
    ...listingWithoutPublicItemUrlWhere,
    product: {
      status: "ACTIVE",
      images: { some: {} },
      AND: [{ brand: { not: null } }, { NOT: { brand: "" } }],
    },
  }
}

/** Oldest listing first (FIFO). `createdAt`, not `updatedAt` — edits must not jump the queue. */
export const AUTOPOST_PICK_ORDER_BY = { createdAt: "asc" } as const

export const AUTOPOST_PICK_BATCH = 30

function decimalToNumberOrNull(
  value: { toString(): string } | number | null | undefined,
): number | null {
  if (value == null) return null
  const n = typeof value === "number" ? value : Number(value.toString())
  return Number.isFinite(n) ? n : null
}

export async function findNextAutopostListing(
  prisma: PrismaClient,
  accountId: string,
) {
  return prisma.productListing.findFirst({
    where: autopostEligibleListingWhere(accountId),
    orderBy: AUTOPOST_PICK_ORDER_BY,
    select: { id: true, productId: true, createdAt: true },
  })
}

const autopostPickSelect = {
  id: true,
  productId: true,
  createdAt: true,
  shippingEnabled: true,
  product: {
    select: {
      sku: true,
      title: true,
      weightKg: true,
      widthCm: true,
      lengthCm: true,
      heightCm: true,
    },
  },
} as const

type AutopostCandidate = Prisma.ProductListingGetPayload<{
  select: typeof autopostPickSelect
}>

function listingShippingReady(listing: AutopostCandidate): boolean {
  return isShippingPublishReady({
    weightKg: decimalToNumberOrNull(listing.product.weightKg),
    shippingEnabled: true,
  })
}

function skipAutopostForShipping(listing: AutopostCandidate): void {
  const product = listing.product
  recordAutopostSkip({
    productId: listing.productId,
    sku: product.sku,
    title: product.title,
    code: SHIPPING_NOT_READY_CODE,
    message: SHIPPING_NOT_READY_MESSAGE,
  })
  log("info", "wallapop_autopost_skip_shipping", {
    listingId: listing.id,
    productId: listing.productId,
    sku: product.sku,
    code: SHIPPING_NOT_READY_CODE,
  })
}

export async function pickNextAutopostListing(
  prisma: PrismaClient,
  accountId: string,
): Promise<{
  listing: { id: string; productId: string; createdAt: Date } | null
  scanned: number
  skipped: number
}> {
  const candidates = await prisma.productListing.findMany({
    where: autopostEligibleListingWhere(accountId),
    orderBy: AUTOPOST_PICK_ORDER_BY,
    take: AUTOPOST_PICK_BATCH,
    select: autopostPickSelect,
  })
  let skipped = 0
  for (const listing of candidates) {
    if (listingShippingReady(listing)) {
      return {
        listing: {
          id: listing.id,
          productId: listing.productId,
          createdAt: listing.createdAt,
        },
        scanned: candidates.length,
        skipped,
      }
    }
    skipped += 1
    skipAutopostForShipping(listing)
  }
  return { listing: null, scanned: candidates.length, skipped }
}
