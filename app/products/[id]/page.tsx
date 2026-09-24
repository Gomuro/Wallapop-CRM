import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronLeftIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  DeleteProductButton,
  SoldSyncButton,
} from "@/components/product-form/product-actions"
import { formatEuro, statusLabel } from "@/lib/inventory/format"
import { getProduct } from "@/lib/inventory/store"

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const product = getProduct(id)
  if (!product) notFound()

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center gap-1 border-b bg-background px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <Button
          variant="ghost"
          size="icon"
          nativeButton={false}
          render={<Link href="/" />}
          aria-label="Back to catalog"
        >
          <ChevronLeftIcon />
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold">
          {product.title}
        </h1>
      </header>
      <div className="flex min-w-0 snap-x snap-mandatory gap-2 overflow-x-auto bg-muted px-3 py-3 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {product.images.length === 0 ? (
          <div className="aspect-square w-full max-w-sm rounded-xl bg-background" />
        ) : (
          product.images.map((src) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={src}
              src={src}
              alt=""
              className="aspect-square w-[85%] max-w-sm shrink-0 snap-center rounded-xl object-cover"
            />
          ))
        )}
      </div>
      <main className="space-y-4 px-4 py-4">
        <div>
          <p className="text-2xl font-semibold text-primary">
            {formatEuro(product.price)}
          </p>
          <p className="mt-1 text-lg font-medium leading-snug">{product.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{product.sku}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge>{statusLabel(product.status)}</Badge>
          <Badge variant="outline">{product.category}</Badge>
          <Badge variant="outline">{product.condition}</Badge>
          {product.weight != null ? (
            <Badge variant="secondary">{product.weight} kg</Badge>
          ) : null}
        </div>
        <div>
          <p className="text-sm font-medium">Where it hangs</p>
          {product.listings.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Not listed on any account yet.
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
                    {listing.status.replaceAll("_", " ").toLowerCase()}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Separator />
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
          {product.description || "No description."}
        </p>
        <div className="space-y-2 pt-2">
          <Button
            className="h-11 w-full"
            nativeButton={false}
            render={<Link href={`/products/${product.id}/edit`} />}
          >
            Edit item
          </Button>
          <SoldSyncButton
            productId={product.id}
            disabled={product.status === "SOLD"}
          />
          <DeleteProductButton productId={product.id} />
        </div>
      </main>
    </>
  )
}
