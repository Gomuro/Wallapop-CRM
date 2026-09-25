import { ExternalLinkIcon } from "lucide-react"

import { ListingStatusBadge } from "@/components/catalog/listing-status-badge"
import { listingStatusLabel } from "@/lib/inventory/format"
import type { InventoryListing } from "@/lib/inventory/types"
import { typeSection } from "@/lib/ui/type"

export function ListingDetailSection({
  listing,
  listingActive,
}: {
  listing: InventoryListing | null
  listingActive?: boolean
}) {
  return (
    <div>
      <p className={typeSection}>Де висить</p>
      {!listing ? (
        <p className="mt-1 text-sm text-muted-foreground">
          Not on Wallapop yet (no default listing).
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
          <p className="text-xs text-muted-foreground">
            {listingStatusLabel(listing.status)}
          </p>
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
            <p className="text-sm text-muted-foreground">No public URL yet.</p>
          )}
        </div>
      )}
    </div>
  )
}
