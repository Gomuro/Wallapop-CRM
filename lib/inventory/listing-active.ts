import type { InventoryListing, InventoryProduct } from "@/lib/inventory/types"
import { wallapopEsItemUrlOrNull, wallapopItemUrlOrNull } from "./wallapop-item-url"

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

/** «Eliminar en Wallapop»: live listing with a public es /item/ URL, not sold. */
export function canEliminarOnWallapop(product: InventoryProduct): boolean {
  if (product.status === "SOLD") return false
  const listing = product.listing
  if (!listing || !isLiveOnWallapopStatus(listing.status)) return false
  return wallapopEsItemUrlOrNull(listing.externalUrl) != null
}

/** «Poner en cola»: listing taken off Wallapop, product still for sale. */
export function canRequeueListing(product: InventoryProduct): boolean {
  return product.status !== "SOLD" && product.listing?.status === "DEACTIVATED"
}

export function withListingActive(product: InventoryProduct): InventoryProduct {
  const active = computeListingActive(product.listing, product.listingActive)
  return {
    ...product,
    listingActive: active,
  }
}
