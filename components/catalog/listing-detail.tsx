import type { ReactNode } from "react"
import { ExternalLinkIcon } from "lucide-react"

import { ClearListingLinkButton } from "@/components/catalog/clear-listing-link-button"
import { ListingStatusBadge } from "@/components/catalog/listing-status-badge"
import { Badge } from "@/components/ui/badge"
import { formatListingPostedAt } from "@/lib/inventory/format"
import { isLiveOnWallapopStatus } from "@/lib/inventory/listing-active"
import { SHIPPING_NOT_READY_MESSAGE } from "@/lib/inventory/shipping-for-publish"
import type { InventoryListing, InventoryProduct } from "@/lib/inventory/types"
import { wallapopItemUrlOrNull } from "@/lib/inventory/wallapop-item-url"
import { typeSection } from "@/lib/ui/type"

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
  MISSING: "Desaparecido de la caja",
  DEACTIVATED: "Desactivado",
  READY_TO_POST: "En cola de publicación",
  POSTING: "Publicando…",
  FAILED: "Error al publicar",
}

function listingEstadoLabel(
  listing: InventoryListing,
  posted: boolean,
  productSold: boolean,
  warehouseInactive: boolean,
) {
  if (listing.status === "RESERVED") return "Reservado"
  if (listing.status === "MISSING") return "Desaparecido de la caja"
  if (posted) return "Publicado"
  if (listing.status === "DEACTIVATED" && productSold) {
    return "Vendido en Wallapop"
  }
  if (
    warehouseInactive &&
    (listing.status === "READY_TO_POST" || listing.status === "FAILED")
  ) {
    return "Sin publicar"
  }
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
  missing,
  productId,
  shippingIncomplete,
}: {
  junkUrl: boolean
  ready: boolean
  missing: boolean
  productId?: string
  shippingIncomplete: boolean
}) {
  return (
    <div className="space-y-2 px-3 py-3">
      {missing ? (
        <p className="text-sm leading-snug text-muted-foreground">
          Ya no está en Wallapop. El CRM no lo eliminó. El enlace se
          conserva para comprobarlo. Para volver a publicar, ponlo en cola.
        </p>
      ) : null}
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
  productSold = false,
  warehouseStatus,
  heading = "Anuncio en Wallapop",
  children,
}: {
  productId?: string
  listing: InventoryListing | null
  listingActive?: boolean
  shippingIncomplete?: boolean
  productSold?: boolean
  warehouseStatus?: InventoryProduct["status"]
  heading?: string
  children?: ReactNode
}) {
  const itemUrl = wallapopItemUrlOrNull(listing?.externalUrl)
  const junkUrl = Boolean(listing?.externalUrl) && !itemUrl
  const ready = listing?.status === "READY_TO_POST"
  const missing = listing?.status === "MISSING"
  const posted = isLiveOnWallapopStatus(listing?.status) && Boolean(itemUrl)
  const showPostedAt =
    Boolean(listing?.lastPostedAt) &&
    (posted || listing?.status === "DEACTIVATED" || missing)
  const detectedAt =
    missing && listing?.updatedAt
      ? formatListingPostedAt(listing.updatedAt)
      : null
  const estado = listing
    ? listingEstadoLabel(
        listing,
        posted,
        productSold,
        warehouseStatus === "INACTIVE",
      )
    : "Sin publicar"

  return (
    <section className="overflow-hidden rounded-xl ring-1 ring-border">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2.5">
        <p className={typeSection}>{heading}</p>
        {listing ? (
          <ListingStatusBadge
            product={{
              listing,
              listingActive,
              status: warehouseStatus ?? "ACTIVE",
            }}
            className="shrink-0"
          />
        ) : (
          <Badge variant="outline" className="shrink-0">
            Sin publicar
          </Badge>
        )}
      </div>
      <div className="divide-y divide-border px-3">
        <MetaRow label="Estado">{estado}</MetaRow>
        {listing?.accountName?.trim() &&
        listing.accountName.trim() !== heading ? (
          <MetaRow label="Caja">{listing.accountName.trim()}</MetaRow>
        ) : null}
        <MetaRow label="Enlace">
          <ListingLinkValue itemUrl={itemUrl} junkUrl={junkUrl} />
        </MetaRow>
        {showPostedAt && listing?.lastPostedAt ? (
          <MetaRow label="Publicado">
            {formatListingPostedAt(listing.lastPostedAt)}
          </MetaRow>
        ) : null}
        {detectedAt ? <MetaRow label="Detectado">{detectedAt}</MetaRow> : null}
      </div>
      {listing ? (
        <ListingHints
          junkUrl={junkUrl}
          ready={ready}
          missing={missing}
          productId={productId}
          shippingIncomplete={shippingIncomplete}
        />
      ) : null}
      {children ? (
        <div className="space-y-2 px-3 pb-3 empty:hidden">{children}</div>
      ) : null}
    </section>
  )
}
