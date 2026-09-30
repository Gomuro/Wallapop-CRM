import { ExternalLinkIcon } from "lucide-react"

import { ListingStatusBadge } from "@/components/catalog/listing-status-badge"
import { formatListingPostedAt } from "@/lib/inventory/format"
import { SHIPPING_NOT_READY_MESSAGE } from "@/lib/inventory/shipping-for-publish"
import type { InventoryListing } from "@/lib/inventory/types"
import { typeSection } from "@/lib/ui/type"

export function ListingDetailSection({
  listing,
  listingActive,
  shippingIncomplete = false,
}: {
  listing: InventoryListing | null
  listingActive?: boolean
  shippingIncomplete?: boolean
}) {
  return (
    <div>
      <p className={typeSection}>Anuncio en Wallapop</p>
      {!listing ? (
        <p className="mt-1 text-sm text-muted-foreground">
          Aún no está en Wallapop.
        </p>
      ) : (
        <div className="mt-2 space-y-2 rounded-lg border px-3 py-2.5">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">Wallapop</span>
            <ListingStatusBadge
              product={{ listing, listingActive }}
              className="shrink-0"
            />
          </div>
          {listing.externalUrl ? (
            <a
              href={listing.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-11 items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              <ExternalLinkIcon className="size-4 shrink-0" />
              <span className="min-w-0 truncate">{listing.externalUrl}</span>
            </a>
          ) : (
            <p className="text-sm text-muted-foreground">Todavía no hay enlace público.</p>
          )}
          {listing.lastPostedAt ? (
            <p className="text-xs text-muted-foreground">
              Publicado {formatListingPostedAt(listing.lastPostedAt)}
            </p>
          ) : null}
          {shippingIncomplete ? (
            <p className="text-sm text-muted-foreground" role="status">
              {SHIPPING_NOT_READY_MESSAGE}
            </p>
          ) : null}
        </div>
      )}
    </div>
  )
}
