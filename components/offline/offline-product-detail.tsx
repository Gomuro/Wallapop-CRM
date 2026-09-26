"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronLeftIcon } from "lucide-react"

import { ProductGallery } from "@/components/catalog/product-gallery"
import { ListingDetailSection } from "@/components/catalog/listing-detail"
import { OfflineBanner } from "@/components/offline/offline-banner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { deleteOfflineProduct, markOfflineProductSold } from "@/lib/offline/cache"
import { useOfflineProduct } from "@/lib/offline/use-offline-cache"
import {
  categoryLabel,
  conditionLabel,
  formatEuro,
  statusLabel,
} from "@/lib/inventory/format"
import { typeMeta, typePrice, typeScreen } from "@/lib/ui/type"
import { cn } from "@/lib/utils"

export function OfflineProductDetail({ id }: { id: string }) {
  const router = useRouter()
  const product = useOfflineProduct(id)

  if (product === undefined) {
    return (
      <>
        <OfflineBanner />
        <p className="px-4 py-8 text-sm text-muted-foreground">Cargando producto…</p>
      </>
    )
  }

  if (!product) {
    return (
      <>
        <OfflineBanner />
        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <p className="text-sm text-muted-foreground">
            Este producto no está en la caché de este dispositivo.
          </p>
          <Button className="h-11" nativeButton={false} render={<Link href="/" />}>
            Volver al catálogo
          </Button>
        </div>
      </>
    )
  }

  return (
    <>
      <OfflineBanner />
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
        <h1 className={cn(typeScreen, "min-w-0 flex-1 truncate")}>{product.title}</h1>
      </header>
      <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-8 lg:px-8 lg:py-6">
        <div className="min-w-0 lg:col-span-6">
          <ProductGallery images={product.images} alt={product.title} />
        </div>
        <aside className="space-y-4 px-4 pt-4 pb-16 md:px-8 md:pb-8 lg:sticky lg:top-28 lg:col-span-6 lg:self-start lg:px-0 lg:pt-0 lg:pb-0">
          <div>
            <p className={cn(typePrice, "text-primary-text")}>
              {formatEuro(product.price)}
            </p>
            <p className="mt-1 text-lg font-medium leading-snug">{product.title}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge
              className={
                product.status === "ACTIVE" ? "bg-foreground text-background" : undefined
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
            <Button
              className="h-12 w-full"
              variant={product.status === "SOLD" ? "secondary" : "default"}
              disabled={product.status === "SOLD"}
              onClick={() => {
                markOfflineProductSold(product.id)
              }}
            >
              {product.status === "SOLD" ? "Vendido" : "Marcar como vendido"}
            </Button>
            <Button
              className="h-12 w-full text-destructive"
              variant="ghost"
              onClick={() => {
                deleteOfflineProduct(product.id)
                router.push("/")
                router.refresh()
              }}
            >
              Eliminar
            </Button>
          </div>
        </aside>
      </div>
    </>
  )
}
