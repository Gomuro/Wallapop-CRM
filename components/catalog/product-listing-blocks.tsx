import {
  DevolucionButton,
  EliminarWallapopButton,
  RequeueListingButton,
} from "@/components/product-form/listing-actions"
import { SoldSyncButton } from "@/components/product-form/product-actions"
import { ListingDetailSection } from "@/components/catalog/listing-detail"
import {
  canEliminarOnListing,
  canMarkSoldOnListing,
  canRequeueListing,
  canStartDevolucionOnListing,
  computeListingActive,
} from "@/lib/inventory/listing-active"
import type { InventoryListing, InventoryProduct } from "@/lib/inventory/types"
import { wallapopEsItemUrlOrNull } from "@/lib/inventory/wallapop-item-url"

function blocksFor(product: InventoryProduct): InventoryListing[] {
  if (product.listings && product.listings.length > 0) return product.listings
  return product.listing ? [product.listing] : []
}

function isFirstAccountListing(
  product: InventoryProduct,
  listing: InventoryListing,
): boolean {
  if (listing.isDefault) return true
  return product.listing != null && listing.id === product.listing.id
}

function ListingActions({
  product,
  listing,
}: {
  product: InventoryProduct
  listing: InventoryListing
}) {
  const label = listing.accountName?.trim() || "Cuenta"
  const first = isFirstAccountListing(product, listing)
  const showSold = canMarkSoldOnListing(product.status, listing)
  const showEliminar = canEliminarOnListing(product.status, listing)
  const showDevolucion = canStartDevolucionOnListing(product, listing)
  const showRequeue = first && canRequeueListing(product) && listing.status === "DEACTIVATED"

  if (!showSold && !showEliminar && !showDevolucion && !showRequeue) return null

  return (
    <div className="space-y-2">
      {showDevolucion ? (
        <DevolucionButton
          productId={product.id}
          accountId={listing.accountId}
          accountLabel={label}
          hasItemUrl={wallapopEsItemUrlOrNull(listing.externalUrl) != null}
        />
      ) : null}
      {showSold ? (
        <SoldSyncButton
          productId={product.id}
          accountId={listing.accountId}
          accountLabel={label}
        />
      ) : null}
      {showEliminar ? (
        <EliminarWallapopButton
          productId={product.id}
          accountId={listing.accountId}
          accountLabel={label}
        />
      ) : null}
      {showRequeue ? <RequeueListingButton productId={product.id} /> : null}
    </div>
  )
}

export function ProductListingBlocks({ product }: { product: InventoryProduct }) {
  const listings = blocksFor(product)
  if (listings.length === 0) {
    return (
      <ListingDetailSection
        productId={product.id}
        listing={null}
        listingActive={product.listingActive}
        shippingIncomplete={!product.shippingPublishReady}
        productSold={product.status === "SOLD"}
        warehouseStatus={product.status}
      />
    )
  }

  return (
    <div className="space-y-4">
      {listings.map((listing) => {
        const label = listing.accountName?.trim() || "Cuenta"
        const first = isFirstAccountListing(product, listing)
        return (
          <div key={listing.id || listing.accountId} className="space-y-2">
            <ListingDetailSection
              heading={label}
              productId={first ? product.id : undefined}
              listing={listing}
              listingActive={computeListingActive(listing)}
              shippingIncomplete={first && !product.shippingPublishReady}
              productSold={
                product.status === "SOLD" &&
                canStartDevolucionOnListing(product, listing)
              }
              warehouseStatus={product.status}
            />
            <ListingActions product={product} listing={listing} />
          </div>
        )
      })}
    </div>
  )
}
