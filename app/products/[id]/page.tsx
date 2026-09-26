import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronLeftIcon } from "lucide-react"

import { ApiUnavailable } from "@/components/api/api-unavailable"
import { ProductLoadError } from "@/components/catalog/product-load-error"
import { ProductGallery } from "@/components/catalog/product-gallery"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  DeleteProductButton,
  SoldSyncButton,
} from "@/components/product-form/product-actions"
import { ListingDetailSection } from "@/components/catalog/listing-detail"
import {
  categoryLabel,
  conditionLabel,
  formatEuro,
  statusLabel,
} from "@/lib/inventory/format"
import { ProductCacheHydrator } from "@/components/offline/product-cache-hydrator"
import { apiUnavailableReason } from "@/lib/api/availability"
import { isApiConfigured } from "@/lib/api/config"
import { getProduct } from "@/lib/inventory/store"
import { typeMeta, typePrice, typeScreen } from "@/lib/ui/type"
import { cn } from "@/lib/utils"

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (!isApiConfigured()) {
    return <ApiUnavailable reason="config" />
  }

  const { id } = await params
  if (id.startsWith("offline_")) {
    notFound()
  }

  let product: Awaited<ReturnType<typeof getProduct>>
  try {
    product = await getProduct(id)
  } catch (error) {
    if (apiUnavailableReason(error) === "config") {
      return <ApiUnavailable reason="config" />
    }
    return <ProductLoadError />
  }
  if (!product) notFound()

  return (
    <>
      <ProductCacheHydrator product={product} />
      <header className="sticky top-0 z-30 flex items-center gap-1 border-b bg-background px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:top-14 md:px-8">
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
        <aside className="space-y-4 px-4 pt-4 pb-[calc(9rem+env(safe-area-inset-bottom))] md:px-8 md:pb-8 lg:sticky lg:top-28 lg:col-span-6 lg:self-start lg:px-0 lg:pt-0 lg:pb-0">
          <div>
            <p className={cn(typePrice, "text-primary-text")}>
              {formatEuro(product.price)}
            </p>
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
          <ListingDetailSection
            listing={product.listing}
            listingActive={product.listingActive}
          />
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
            <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t bg-background/95 px-4 py-3 backdrop-blur-sm md:static md:inset-auto md:z-auto md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
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
