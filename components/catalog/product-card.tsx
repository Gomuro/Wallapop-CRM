import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { formatEuro, statusLabel } from "@/lib/inventory/format"
import type { InventoryProduct } from "@/lib/inventory/types"
import type { ProductStatus } from "@/lib/validations"

function statusVariant(status: ProductStatus) {
  if (status === "SOLD") return "secondary" as const
  if (status === "INACTIVE") return "outline" as const
  return "default" as const
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
      <Link href={`/products/${product.id}`} className="block">
        <Card size="sm" className="flex-row items-stretch gap-0 py-0">
          <div className="relative size-24 shrink-0 overflow-hidden bg-muted">
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cover}
                alt=""
                className="size-full object-cover"
              />
            ) : (
              <div className="size-full bg-muted" />
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-between p-3">
            <div>
              <p className="text-sm font-medium text-primary">{formatEuro(product.price)}</p>
              <p className="mt-0.5 line-clamp-2 text-sm leading-snug">{product.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{product.sku}</p>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              <Badge variant={statusVariant(product.status)}>
                {statusLabel(product.status)}
              </Badge>
              {accounts.map((listing) => (
                <Badge key={listing.id} variant="outline">
                  {listing.accountName}
                </Badge>
              ))}
            </div>
          </div>
        </Card>
      </Link>
    )
  }

  return (
    <Link href={`/products/${product.id}`} className="block">
      <Card className="gap-0 py-0">
        <div className="relative aspect-square overflow-hidden bg-muted">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt="" className="size-full object-cover" />
          ) : null}
          <span className="absolute bottom-2 left-2 rounded-md bg-background/95 px-1.5 py-0.5 text-sm font-semibold text-primary shadow-sm">
            {formatEuro(product.price)}
          </span>
        </div>
        <div className="space-y-1.5 p-2.5">
          <p className="line-clamp-2 min-h-10 text-sm leading-snug">{product.title}</p>
          <div className="flex flex-wrap gap-1">
            <Badge variant={statusVariant(product.status)}>
              {statusLabel(product.status)}
            </Badge>
            {accounts.map((listing) => (
              <Badge key={listing.id} variant="outline">
                {listing.accountName}
              </Badge>
            ))}
          </div>
        </div>
      </Card>
    </Link>
  )
}
