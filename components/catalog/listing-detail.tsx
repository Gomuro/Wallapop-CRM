import type { ReactNode } from "react"
import { ExternalLinkIcon } from "lucide-react"

import { ClearListingLinkButton } from "@/components/catalog/clear-listing-link-button"
import { ListingStatusBadge } from "@/components/catalog/listing-status-badge"
import { formatListingPostedAt } from "@/lib/inventory/format"
import { SHIPPING_NOT_READY_MESSAGE } from "@/lib/inventory/shipping-for-publish"
import type { InventoryListing } from "@/lib/inventory/types"
import { wallapopItemUrlOrNull } from "@/lib/inventory/wallapop-item-url"
import { typeMeta, typeSection } from "@/lib/ui/type"

function MetaRow({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <div className="min-w-0 text-right text-sm font-medium">{children}</div>
    </div>
  )
}

export function ListingDetailSection({
  productId,
  listing,
  listingActive,
  shippingIncomplete = false,
}: {
  productId?: string
  listing: InventoryListing | null
  listingActive?: boolean
  shippingIncomplete?: boolean
}) {
  const itemUrl = wallapopItemUrlOrNull(listing?.externalUrl)
  const junkUrl = Boolean(listing?.externalUrl) && !itemUrl
  const ready = listing?.status === "READY_TO_POST"
  const posted = listing?.status === "ACTIVE" && Boolean(itemUrl)

  return (
    <section>
      <p className={typeSection}>Anuncio en Wallapop</p>
      {!listing ? (
        <p className="mt-1 text-sm text-muted-foreground">
          Aún no está en Wallapop.
        </p>
      ) : (
        <div className="mt-2 overflow-hidden rounded-xl ring-1 ring-border">
          <div className="flex items-center justify-between gap-2 bg-muted/50 px-3 py-2.5">
            <span className={typeMeta}>Wallapop</span>
            <ListingStatusBadge
              product={{ listing, listingActive }}
              className="shrink-0"
            />
          </div>
          <div className="divide-y divide-border px-3">
            <MetaRow label="Estado">
              {posted
                ? "Publicado"
                : ready
                  ? "En cola de publicación"
                  : listing.status === "POSTING"
                    ? "Publicando…"
                    : "Sin publicar"}
            </MetaRow>
            <MetaRow label="Enlace">
              {posted && itemUrl ? (
                <a
                  href={itemUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-end gap-1.5 text-primary"
                >
                  <span className="truncate">Ver anuncio</span>
                  <ExternalLinkIcon className="size-3.5 shrink-0" />
                </a>
              ) : junkUrl ? (
                <span className="font-normal text-muted-foreground">
                  No es un anuncio
                </span>
              ) : (
                <span className="font-normal text-muted-foreground">
                  Todavía no hay
                </span>
              )}
            </MetaRow>
            {posted && listing.lastPostedAt ? (
              <MetaRow label="Publicado">
                {formatListingPostedAt(listing.lastPostedAt)}
              </MetaRow>
            ) : null}
          </div>
          <div className="space-y-2 px-3 py-3">
            {junkUrl ? (
              <p className="text-sm leading-snug text-muted-foreground">
                El enlace guardado es la página de alta, no el anuncio. El
                autopost no lo cogerá hasta que lo quites.
              </p>
            ) : ready ? (
              <p className="text-sm leading-snug text-muted-foreground">
                En cola. El autopost lo publicará cuando toque.
              </p>
            ) : null}

            {junkUrl && productId ? (
              <ClearListingLinkButton productId={productId} variant="default" />
            ) : null}

            {shippingIncomplete ? (
              <p className="text-sm text-muted-foreground" role="status">
                {SHIPPING_NOT_READY_MESSAGE}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </section>
  )
}
