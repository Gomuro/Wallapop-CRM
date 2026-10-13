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

/** «Devolución»: sold SKU comes back (Eliminar on Wallapop if needed, then cola). */
export function canStartDevolucion(product: InventoryProduct): boolean {
  if (product.status !== "SOLD") return false
  return product.listing?.status !== "POSTING"
}

/** Live /item/ or a publish in flight — warehouse must not flip to Inactivo. */
export function listingBlocksWarehouseInactive(
  listing:
    | Pick<InventoryListing, "status" | "externalUrl">
    | null
    | undefined,
): boolean {
  if (!listing) return false
  if (listing.status === "POSTING") return true
  return computeListingActive(listing)
}

/**
 * «Marcar como inactivo»: warehouse En venta, and the ad is not on Wallapop.
 * Sold / live / Publicando stay blocked so CRM does not invent an off-site state.
 */
export function canMarkWarehouseInactive(product: InventoryProduct): boolean {
  if (product.status !== "ACTIVE") return false
  return !listingBlocksWarehouseInactive(product.listing)
}

export function withListingActive(product: InventoryProduct): InventoryProduct {
  const active = computeListingActive(product.listing, product.listingActive)
  return {
    ...product,
    listingActive: active,
  }
}
