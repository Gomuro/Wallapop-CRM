import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronLeftIcon } from "lucide-react"

import { ProductGallery } from "@/components/catalog/product-gallery"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  DeleteProductButton,
  SoldSyncButton,
} from "@/components/product-form/product-actions"
import { formatEuro, listingStatusLabel, statusLabel, categoryLabel, conditionLabel } from "@/lib/inventory/format"
import { getProduct } from "@/lib/inventory/store"
import { typeMeta, typePrice, typeScreen, typeSection } from "@/lib/ui/type"
import { cn } from "@/lib/utils"

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const product = await getProduct(id)
  if (!product) notFound()

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center gap-1 border-b bg-background px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:top-14 md:px-8">
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          nativeButton={false}
          render={<Link href="/" />}
          aria-label="Volver al catálogo"
        >
          <ChevronLeftIcon />
        </Button>
        <h1 className={cn(typeScreen, "min-w-0 flex-1 truncate")}>
          {product.title}
        </h1>
      </header>
      <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-8 lg:px-8 lg:py-6">
        <div className="min-w-0 lg:col-span-6">
          <ProductGallery
            key={product.id}
            images={product.images}
            alt={product.title}
          />
        </div>
        <aside className="space-y-4 px-4 pt-4 pb-16 md:px-8 md:pb-8 lg:sticky lg:top-28 lg:col-span-6 lg:self-start lg:px-0 lg:pt-0 lg:pb-0">
          <div>
            <div className="flex min-w-0 items-baseline justify-between gap-2">
              <p className={cn(typePrice, "text-primary-text")}>
                {formatEuro(product.price)}
              </p>
              <p className={cn(typeMeta, "text-muted-foreground")}>{product.sku}</p>
            </div>
            <p className="mt-1 text-lg font-medium leading-snug">{product.title}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge
              className={
                product.status === "ACTIVE"
                  ? "bg-foreground text-background"
                  : undefined
              }
              variant={
                product.status === "SOLD"
                  ? "secondary"
                  : product.status === "INACTIVE"
                    ? "outline"
                    : "default"
              }
            >
              {statusLabel(product.status)}
            </Badge>
            <Badge variant="outline">{categoryLabel(product.category)}</Badge>
            <Badge variant="outline">{conditionLabel(product.condition)}</Badge>
            {product.weight != null ? (
              <Badge variant="secondary">{product.weight} kg</Badge>
            ) : null}
          </div>
          <div>
            <p className={typeSection}>Publicado en</p>
            {product.listings.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Todavía no está en ninguna cuenta.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {product.listings.map((listing) => (
                  <li
                    key={listing.id}
                    className="flex min-w-0 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate">{listing.accountName}</span>
                    <Badge
                      className="shrink-0"
                      variant={
                        listing.status === "ACTIVE" ? "default" : "outline"
                      }
                    >
                      {listingStatusLabel(listing.status)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Separator />
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {product.description || "Sin descripción."}
          </p>
          <div className="space-y-2 pt-2">
            <Button
              className="h-12 w-full"
              nativeButton={false}
              render={<Link href={`/products/${product.id}/edit`} />}
            >
              Editar producto
            </Button>
            <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 border-t bg-background/95 px-4 py-3 backdrop-blur-sm md:static md:inset-auto md:z-auto md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
              <SoldSyncButton
                productId={product.id}
                disabled={product.status === "SOLD"}
              />
            </div>
            <DeleteProductButton productId={product.id} />
          </div>
        </aside>
      </div>
    </>
  )
}
