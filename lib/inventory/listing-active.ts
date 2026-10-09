import type { InventoryListing, InventoryProduct } from "@/lib/inventory/types"

/** Live Wallapop listing: en venta or reserved (warehouse still ACTIVE). */
export function isLiveOnWallapopStatus(
  status: string | null | undefined,
): boolean {
  return status === "ACTIVE" || status === "RESERVED"
}

export function computeListingActive(
  listing: InventoryListing | null | undefined,
  listingActive?: boolean,
): boolean {
  if (listing?.status === "POSTING") return false
  if (listing) return isLiveOnWallapopStatus(listing.status)
  return Boolean(listingActive)
}

export function withListingActive(product: InventoryProduct): InventoryProduct {
  const active = computeListingActive(product.listing, product.listingActive)
  return {
    ...product,
    listingActive: active,
  }
}
