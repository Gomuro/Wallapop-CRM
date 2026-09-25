import type { InventoryListing, InventoryProduct } from "@/lib/inventory/types"

export function computeListingActive(
  listing: InventoryListing | null | undefined,
  listingActive?: boolean,
): boolean {
  if (listingActive === true) return true
  if (listingActive === false) return false
  return listing?.status === "ACTIVE"
}

export function withListingActive(product: InventoryProduct): InventoryProduct {
  const active = computeListingActive(product.listing, product.listingActive)
  return {
    ...product,
    listingActive: active,
  }
}
