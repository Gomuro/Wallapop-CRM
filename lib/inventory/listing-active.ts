import type { InventoryListing, InventoryProduct } from "@/lib/inventory/types"
import { wallapopItemUrlOrNull } from "./wallapop-item-url"

/** Live Wallapop listing: en venta or reserved (warehouse still ACTIVE). */
export function isLiveOnWallapopStatus(
  status: string | null | undefined,
): boolean {
  return status === "ACTIVE" || status === "RESERVED"
}

export function listingHasPublicItemUrl(
  url: string | null | undefined,
): boolean {
  return wallapopItemUrlOrNull(url) != null
}

/** En Wallapop only with a public /item/ URL. Upload/catalog pages do not count. */
export function computeListingActive(
  listing:
    | Pick<InventoryListing, "status" | "externalUrl">
    | null
    | undefined,
  listingActive?: boolean,
): boolean {
  if (listing?.status === "POSTING") return false
  if (listing) {
    return (
      isLiveOnWallapopStatus(listing.status) &&
      listingHasPublicItemUrl(listing.externalUrl)
    )
  }
  return Boolean(listingActive)
}

export function withListingActive(product: InventoryProduct): InventoryProduct {
  const active = computeListingActive(product.listing, product.listingActive)
  return {
    ...product,
    listingActive: active,
  }
}
