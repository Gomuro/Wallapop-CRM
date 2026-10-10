import type { ReactNode } from "react"
import { ExternalLinkIcon } from "lucide-react"

import { ClearListingLinkButton } from "@/components/catalog/clear-listing-link-button"
import { ListingStatusBadge } from "@/components/catalog/listing-status-badge"
import { formatListingPostedAt } from "@/lib/inventory/format"
import { isLiveOnWallapopStatus } from "@/lib/inventory/listing-active"
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

const LISTING_ESTADO: Record<string, string> = {
  RESERVED: "Reservado",
  DEACTIVATED: "Vendido en Wallapop",
  READY_TO_POST: "En cola de publicación",
  POSTING: "Publicando…",
  FAILED: "Error al publicar",
}

function listingEstadoLabel(listing: InventoryListing, posted: boolean) {
  if (listing.status === "RESERVED") return "Reservado"
  if (posted) return "Publicado"
  return LISTING_ESTADO[listing.status] ?? "Sin publicar"
}

function ListingLinkValue({
  itemUrl,
  junkUrl,
}: {
  itemUrl: string | null
  junkUrl: boolean
}) {
  if (itemUrl) {
    return (
      <a
        href={itemUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-end gap-1.5 text-primary"
      >
        <span className="truncate">Ver anuncio</span>
        <ExternalLinkIcon className="size-3.5 shrink-0" />
      </a>
    )
  }
  return (
    <span className="font-normal text-muted-foreground">
      {junkUrl ? "No es un anuncio" : "Todavía no hay"}
    </span>
  )
}

function ListingHints({
  junkUrl,
  ready,
  productId,
  shippingIncomplete,
}: {
  junkUrl: boolean
  ready: boolean
  productId?: string
  shippingIncomplete: boolean
}) {
  return (
    <div className="space-y-2 px-3 py-3">
      {junkUrl ? (
        <p className="text-sm leading-snug text-muted-foreground">
          El enlace guardado es la página de alta, no el anuncio. El
          autopost no lo cogerá hasta que lo quites.
        </p>
      ) : null}
      {ready && !junkUrl ? (
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
  const posted = isLiveOnWallapopStatus(listing?.status) && Boolean(itemUrl)
  const showPostedAt =
    Boolean(listing?.lastPostedAt) &&
    (posted || listing?.status === "DEACTIVATED")

  if (!listing) {
    return (
      <section>
        <p className={typeSection}>Anuncio en Wallapop</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Aún no está en Wallapop.
        </p>
      </section>
    )
  }

  return (
    <section>
      <p className={typeSection}>Anuncio en Wallapop</p>
      <div className="mt-2 overflow-hidden rounded-xl ring-1 ring-border">
        <div className="flex items-center justify-between gap-2 bg-muted/50 px-3 py-2.5">
          <span className={typeMeta}>Wallapop</span>
          <ListingStatusBadge
            product={{ listing, listingActive }}
            className="shrink-0"
          />
        </div>
        <div className="divide-y divide-border px-3">
          <MetaRow label="Estado">{listingEstadoLabel(listing, posted)}</MetaRow>
          <MetaRow label="Enlace">
            <ListingLinkValue itemUrl={itemUrl} junkUrl={junkUrl} />
          </MetaRow>
          {showPostedAt && listing.lastPostedAt ? (
            <MetaRow label="Publicado">
              {formatListingPostedAt(listing.lastPostedAt)}
            </MetaRow>
          ) : null}
        </div>
        <ListingHints
          junkUrl={junkUrl}
          ready={ready}
          productId={productId}
          shippingIncomplete={shippingIncomplete}
        />
      </div>
    </section>
  )
}
