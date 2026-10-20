import type { ReactNode } from "react"
import { CheckIcon } from "lucide-react"

import { CatalogLink } from "@/components/catalog/catalog-link"
import {
  CATALOG_GRID_SIZES,
  CATALOG_LIST_SIZES,
  ProductImage,
} from "@/components/catalog/product-image"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { ListingStatusBadge } from "@/components/catalog/listing-status-badge"
import {
  accountGlanceIsLive,
  accountGlanceLabel,
  formatEuro,
  formatListingPostedAt,
  statusLabel,
} from "@/lib/inventory/format"
import {
  SHIPPING_INCOMPLETE_BADGE,
  showShippingIncompleteBadge,
} from "@/lib/inventory/shipping-for-publish"
import type { InventoryProduct } from "@/lib/inventory/types"
import type { ProductStatus } from "@/lib/validations"
import { typePrice } from "@/lib/ui/type"
import { cn } from "@/lib/utils"

function statusVariant(status: ProductStatus) {
  if (status === "SOLD") return "secondary" as const
  if (status === "INACTIVE") return "outline" as const
  return "default" as const
}

function OverlayStatusBadge({
  status,
  className,
}: {
  status: ProductStatus
  className?: string
}) {
  return (
    <span
      className={cn(
        "absolute z-10 max-w-[calc(100%-0.75rem)] rounded-full bg-background/95 shadow-sm ring-1 ring-border backdrop-blur-sm",
        className,
      )}
    >
      <Badge
        variant={statusVariant(status)}
        className={cn(
          "max-w-full shrink truncate shadow-none",
          status === "ACTIVE" && "bg-foreground text-background",
          status === "SOLD" && "bg-secondary text-secondary-foreground",
          status === "INACTIVE" && "border-border bg-background text-foreground",
        )}
      >
        {statusLabel(status)}
      </Badge>
    </span>
  )
}

function ShippingIncompleteBadge({ product }: { product: InventoryProduct }) {
  if (
    !showShippingIncompleteBadge({
      status: product.status,
      listing: product.listing,
      listingActive: product.listingActive,
      shippingPublishReady: product.shippingPublishReady,
    })
  ) {
    return null
  }
  return (
    <Badge className="max-w-full shrink truncate bg-primary text-primary-foreground shadow-none">
      {SHIPPING_INCOMPLETE_BADGE}
    </Badge>
  )
}

function Price({ price }: { price: number }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2">
      <p className={cn(typePrice, "shrink-0 text-primary-text")}>
        {formatEuro(price)}
      </p>
    </div>
  )
}

function SelectMark({ selected }: { selected: boolean }) {
  return (
    <span
      className={cn(
        "flex size-6 items-center justify-center rounded-sm border-2 bg-background text-xs font-semibold shadow-sm",
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-foreground/40",
      )}
      aria-hidden
    >
      {selected ? <CheckIcon className="size-4" strokeWidth={2.5} /> : null}
    </span>
  )
}

function ProductCardFrame({
  productId,
  selecting,
  selected,
  onToggle,
  onHold,
  className,
  children,
}: {
  productId: string
  selecting: boolean
  selected: boolean
  onToggle?: () => void
  onHold?: () => void
  className: string
  children: ReactNode
}) {
  if (selecting) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className={className}
        aria-pressed={selected}
      >
        {children}
      </button>
    )
  }
  return (
    <CatalogLink
      href={`/products/${productId}`}
      className={className}
      onHold={onHold}
    >
      {children}
    </CatalogLink>
  )
}

function AccountMarks({
  product,
  focusAccountId,
}: {
  product: InventoryProduct
  focusAccountId?: string | null
}) {
  const states = product.accountStates
  if (!states || states.length === 0) return null
  return (
    <ul className="mt-1 flex flex-col gap-0.5">
      {states.map((row) => {
        const focused = focusAccountId === row.accountId
        const live = accountGlanceIsLive(row)
        return (
          <li
            key={row.accountId}
            className={cn(
              "flex items-baseline justify-between gap-2 text-[11px] leading-4",
              focused ? "font-medium" : "text-muted-foreground",
              focused && live && "text-foreground",
            )}
          >
            <span className="shrink-0">{row.accountName}</span>
            <span className="min-w-0 text-right wrap-break-word">{accountGlanceLabel(row)}</span>
          </li>
        )
      })}
    </ul>
  )
}

export function ProductCard({
  product,
  view,
  priority = false,
  selecting = false,
  selected = false,
  focusAccountId = null,
  onToggle,
  onHold,
}: {
  product: InventoryProduct
  view: "grid" | "list"
  priority?: boolean
  selecting?: boolean
  selected?: boolean
  focusAccountId?: string | null
  onToggle?: () => void
  onHold?: () => void
}) {
  const cover = product.images[0]
  const shellClass =
    "group block w-full touch-manipulation rounded-xl text-left outline-none transition-[box-shadow,transform] hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.99]"

  if (view === "list") {
    return (
      <ProductCardFrame
        productId={product.id}
        selecting={selecting}
        selected={selected}
        onToggle={onToggle}
        onHold={onHold}
        className={shellClass}
      >
        <Card size="sm" className="flex-row items-stretch gap-0 py-0 shadow-none">
          <div className="relative size-24 shrink-0 overflow-hidden bg-muted">
            {cover ? (
              <ProductImage
                src={cover}
                alt=""
                sizes={CATALOG_LIST_SIZES}
                priority={priority}
                className={cn(
                  "object-cover transition-transform duration-300 group-hover:scale-[1.03]",
                  product.status === "SOLD" && "opacity-70",
                )}
              />
            ) : (
              <div className="size-full bg-muted" />
            )}
            <OverlayStatusBadge
              status={product.status}
              className="top-1.5 left-1.5"
            />
            {selecting ? (
              <span className="absolute top-1.5 right-1.5">
                <SelectMark selected={selected} />
              </span>
            ) : null}
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-between p-3">
            <div className="min-w-0">
              <Price price={product.price} />
              <p className="mt-0.5 line-clamp-2 text-sm leading-snug">{product.title}</p>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              <ListingStatusBadge product={product} />
              <ShippingIncompleteBadge product={product} />
            </div>
            <AccountMarks
              product={product}
              focusAccountId={selecting ? focusAccountId : null}
            />
            {product.listing?.lastPostedAt ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Publicado{" "}
                {formatListingPostedAt(product.listing.lastPostedAt)}
              </p>
            ) : null}
          </div>
        </Card>
      </ProductCardFrame>
    )
  }

  return (
    <GridProductCard
      product={product}
      cover={cover}
      priority={priority}
      selecting={selecting}
      selected={selected}
      focusAccountId={focusAccountId}
      onToggle={onToggle}
      onHold={onHold}
    />
  )
}

function GridProductCard({
  product,
  cover,
  priority,
  selecting,
  selected,
  focusAccountId,
  onToggle,
  onHold,
}: {
  product: InventoryProduct
  cover: string | undefined
  priority: boolean
  selecting: boolean
  selected: boolean
  focusAccountId?: string | null
  onToggle?: () => void
  onHold?: () => void
}) {
  const gridClass =
    "group flex h-full min-h-0 w-full flex-col touch-manipulation rounded-xl bg-card text-left outline-none ring-1 ring-border transition-[box-shadow,transform] duration-200 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.99]"
  return (
    <ProductCardFrame
      productId={product.id}
      selecting={selecting}
      selected={selected}
      onToggle={onToggle}
      onHold={onHold}
      className={gridClass}
    >
    <Card className="h-full gap-0 overflow-hidden py-0 shadow-none ring-0">
      <div className="relative aspect-square shrink-0 overflow-hidden bg-muted">
          {cover ? (
            <ProductImage
              src={cover}
              alt=""
              sizes={CATALOG_GRID_SIZES}
              priority={priority}
              className={cn(
                "object-cover transition-transform duration-300 group-hover:scale-[1.03]",
                product.status === "SOLD" && "opacity-70",
              )}
            />
          ) : null}
          <OverlayStatusBadge
            status={product.status}
            className="top-2 left-2"
          />
          {selecting ? (
            <span className="absolute top-2 right-2">
              <SelectMark selected={selected} />
            </span>
          ) : null}
        </div>
        <div className="flex flex-1 flex-col gap-1 p-2.5">
          <Price price={product.price} />
          <p className="line-clamp-2 min-h-10 text-sm leading-snug">{product.title}</p>
          <div className="mt-auto flex min-h-5 flex-wrap content-start gap-1">
            <ListingStatusBadge product={product} />
            <ShippingIncompleteBadge product={product} />
          </div>
          <AccountMarks
            product={product}
            focusAccountId={selecting ? focusAccountId : null}
          />
          {product.listing?.lastPostedAt ? (
            <p className="text-xs text-muted-foreground">
              Publicado {formatListingPostedAt(product.listing.lastPostedAt)}
            </p>
          ) : null}
        </div>
      </Card>
    </ProductCardFrame>
  )
}
