import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { formatEuro, statusLabel } from "@/lib/inventory/format"
import type { InventoryProduct } from "@/lib/inventory/types"
import type { ProductStatus } from "@/lib/validations"
import { typeMeta, typePrice } from "@/lib/ui/type"
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
      <Badge variant={statusVariant(status)} className="max-w-full shrink truncate shadow-none">
        {statusLabel(status)}
      </Badge>
    </span>
  )
}

function PriceSku({
  price,
  sku,
}: {
  price: number
  sku: string
}) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2">
      <p className={cn(typePrice, "shrink-0 text-primary")}>
        {formatEuro(price)}
      </p>
      <p className={cn(typeMeta, "min-w-0 truncate text-right text-muted-foreground")}>
        {sku}
      </p>
    </div>
  )
}

export function ProductCard({
  product,
  view,
}: {
  product: InventoryProduct
  view: "grid" | "list"
}) {
  const cover = product.images[0]
  const accounts = product.listings.filter((listing) => listing.status !== "DEACTIVATED")

  if (view === "list") {
    return (
      <Link
        href={`/products/${product.id}`}
        className="group block rounded-xl outline-none transition-[box-shadow,transform] hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.99]"
      >
        <Card size="sm" className="flex-row items-stretch gap-0 py-0 shadow-none">
          <div className="relative size-24 shrink-0 overflow-hidden bg-muted">
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cover}
                alt=""
                className={cn(
                  "size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]",
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
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-between p-3">
            <div className="min-w-0">
              <PriceSku price={product.price} sku={product.sku} />
              <p className="mt-0.5 line-clamp-2 text-sm leading-snug">{product.title}</p>
            </div>
            {accounts.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {accounts.map((listing) => (
                  <Badge
                    key={listing.id}
                    variant="outline"
                    className="max-w-full shrink truncate shadow-none"
                  >
                    {listing.accountName}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        </Card>
      </Link>
    )
  }

  return (
    <Link
      href={`/products/${product.id}`}
      className="group flex h-full min-h-0 flex-col rounded-xl bg-card outline-none ring-1 ring-border transition-[box-shadow,transform] duration-200 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.99]"
    >
      <Card className="h-full gap-0 overflow-hidden py-0 shadow-none ring-0">
        <div className="relative aspect-square shrink-0 overflow-hidden bg-muted">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cover}
              alt=""
              className={cn(
                "size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]",
                product.status === "SOLD" && "opacity-70",
              )}
            />
          ) : null}
          <OverlayStatusBadge
            status={product.status}
            className="top-2 left-2"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1 p-2.5">
          <PriceSku price={product.price} sku={product.sku} />
          <p className="line-clamp-2 min-h-10 text-sm leading-snug">{product.title}</p>
          <div className="mt-auto flex min-h-5 flex-wrap content-start gap-1">
            {accounts.map((listing) => (
              <Badge
                key={listing.id}
                variant="outline"
                className="max-w-full shrink truncate shadow-none"
              >
                {listing.accountName}
              </Badge>
            ))}
          </div>
        </div>
      </Card>
    </Link>
  )
}
