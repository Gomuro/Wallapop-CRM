import { Badge } from "@/components/ui/badge"
import {
  listingBadgeVariant,
  listingIndicatorShort,
} from "@/lib/inventory/format"
import type { InventoryProduct } from "@/lib/inventory/types"
import { cn } from "@/lib/utils"

export function ListingStatusBadge({
  product,
  className,
}: {
  product: Pick<InventoryProduct, "listing" | "listingActive">
  className?: string
}) {
  const label = listingIndicatorShort(product.listing, product.listingActive)
  if (!label) return null

  const variant = listingBadgeVariant(product.listing, product.listingActive)

  return (
    <Badge
      variant={variant}
      className={cn(
        "max-w-full shrink truncate shadow-none",
        variant === "default" && "bg-primary text-primary-foreground",
        className,
      )}
    >
      {label}
    </Badge>
  )
}
