import type { InventoryListing, InventoryProduct } from "@/lib/inventory/types"
import { wallapopEsItemUrlOrNull, wallapopItemUrlOrNull } from "./wallapop-item-url"

/**
 * Catalog delete must take the ad off Wallapop first.
 * En venta / Reservado, or a sold row that still has a public /item/ URL.
 */
export function catalogDeleteNeedsWallapop(input: {
  status: string
  listing:
    | { status: string; externalUrl: string | null }
    | null
    | undefined
}): boolean {
  if (wallapopEsItemUrlOrNull(input.listing?.externalUrl) == null) return false
  if (input.status === "SOLD") return true
  return isLiveOnWallapopStatus(input.listing?.status)
}

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

/**
 * «Marcar como vendido»: the ad is En venta on Wallapop and has a public es /item/ URL.
 * Queue, Publicando, Reservado and a warehouse-only product have nothing to mark sold.
 */
export function canMarkSoldOnListing(
  warehouseStatus: string,
  listing: Pick<InventoryListing, "status" | "externalUrl">,
): boolean {
  if (warehouseStatus !== "ACTIVE") return false
  if (listing.status !== "ACTIVE") return false
  return wallapopEsItemUrlOrNull(listing.externalUrl) != null
}

export function canMarkSoldOnWallapop(product: InventoryProduct): boolean {
  if (!product.listing) return false
  return canMarkSoldOnListing(product.status, product.listing)
}

/** «Eliminar en Wallapop»: live listing with a public es /item/ URL, not sold. */
export function canEliminarOnListing(
  warehouseStatus: string,
  listing: Pick<InventoryListing, "status" | "externalUrl">,
): boolean {
  if (warehouseStatus === "SOLD") return false
  if (!isLiveOnWallapopStatus(listing.status)) return false
  return wallapopEsItemUrlOrNull(listing.externalUrl) != null
}

export function canEliminarOnWallapop(product: InventoryProduct): boolean {
  if (!product.listing) return false
  return canEliminarOnListing(product.status, product.listing)
}

/** «Poner en cola»: listing taken off Wallapop, product still for sale. */
export function canRequeueListing(product: InventoryProduct): boolean {
  return product.status !== "SOLD" && product.listing?.status === "DEACTIVATED"
}

/** «Devolución»: sold SKU comes back (Eliminar on Wallapop if needed, then cola). */
export function canStartDevolucionOnListing(
  product: {
    status: string
    soldAccountId?: string | null
    listing?: { accountId: string } | null
  },
  listing: Pick<InventoryListing, "status" | "accountId">,
): boolean {
  if (product.status !== "SOLD") return false
  if (listing.status === "POSTING") return false
  if (product.soldAccountId) return listing.accountId === product.soldAccountId
  if (product.listing?.accountId) {
    return listing.accountId === product.listing.accountId
  }
  return true
}

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
