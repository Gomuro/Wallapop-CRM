import {
  DevolucionButton,
  EliminarWallapopButton,
  QueueAccountButton,
  RequeueListingButton,
} from "@/components/product-form/listing-actions"
import { SoldSyncButton } from "@/components/product-form/product-actions"
import { DuplicateVariantPanel } from "@/components/catalog/duplicate-variant"
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
  const showRequeue = canRequeueListing(product, listing)

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
      {showRequeue ? (
        <RequeueListingButton
          productId={product.id}
          accountId={listing.accountId}
        />
      ) : null}
    </div>
  )
}

function ListingBlock({
  product,
  listing,
  heading,
}: {
  product: InventoryProduct
  listing: InventoryListing
  heading: string
}) {
  const first = isFirstAccountListing(product, listing)
  return (
    <ListingDetailSection
      heading={heading}
      productId={first ? product.id : undefined}
      listing={listing}
      listingActive={computeListingActive(listing)}
      shippingIncomplete={first && !product.shippingPublishReady}
      productSold={
        product.status === "SOLD" &&
        canStartDevolucionOnListing(product, listing)
      }
      warehouseStatus={product.status}
    >
      {listing.isDefault ? null : (
        <DuplicateVariantPanel
          productId={product.id}
          accountId={listing.accountId}
          original={{ title: product.title, description: product.description, price: product.price }}
          variant={listing.variant ?? null}
          locked={DUPLICATE_LOCKED.has(listing.status)}
          preparing={listing.status === "PREPARING"}
        />
      )}
      <ListingActions product={product} listing={listing} />
    </ListingDetailSection>
  )
}

/** A live or in-flight duplicate keeps the text Wallapop already shows. */
const DUPLICATE_LOCKED = new Set(["POSTING", "ACTIVE", "RESERVED"])

function UnpublishedAccount({
  productId,
  accountId,
  name,
}: {
  productId: string
  accountId: string
  name: string
}) {
  return (
    <ListingDetailSection heading={name} listing={null}>
      <QueueAccountButton
        productId={productId}
        accountId={accountId}
        accountLabel={name}
      />
    </ListingDetailSection>
  )
}

export function ProductListingBlocks({ product }: { product: InventoryProduct }) {
  const listings = blocksFor(product)
  const states = product.accountStates
  if (states && states.length > 0) {
    return (
      <div className="space-y-4">
        {states.map((state) => {
          const listing =
            listings.find((row) => row.accountId === state.accountId) ?? null
          if (!listing) {
            if (product.status === "SOLD" || product.status === "INACTIVE") {
              return (
                <ListingDetailSection
                  key={state.accountId}
                  heading={state.accountName}
                  listing={null}
                  warehouseStatus={product.status}
                />
              )
            }
            return (
              <UnpublishedAccount
                key={state.accountId}
                productId={product.id}
                accountId={state.accountId}
                name={state.accountName}
              />
            )
          }
          return (
            <ListingBlock
              key={listing.id || state.accountId}
              product={product}
              listing={listing}
              heading={listing.accountName?.trim() || state.accountName}
            />
          )
        })}
      </div>
    )
  }

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
      {listings.map((listing) => (
        <ListingBlock
          key={listing.id || listing.accountId}
          product={product}
          listing={listing}
          heading={listing.accountName?.trim() || "Cuenta"}
        />
      ))}
    </div>
  )
}
