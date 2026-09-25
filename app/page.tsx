import Link from "next/link"

import { CatalogEmpty } from "@/components/catalog/catalog-empty"
import { CatalogView } from "@/components/catalog/catalog-view"
import { ProductCard } from "@/components/catalog/product-card"
import { Button } from "@/components/ui/button"
import { countProductsByStatus, listProducts } from "@/lib/inventory/store"
import type { ProductStatus } from "@/lib/validations"

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; view?: string }>
}) {
  const params = await searchParams
  const q = (firstParam(params.q) ?? "").trim()
  const statusParam = firstParam(params.status) ?? "ALL"
  const status =
    statusParam === "ACTIVE" ||
    statusParam === "SOLD" ||
    statusParam === "INACTIVE"
      ? statusParam
      : "ALL"
  const view = firstParam(params.view) === "list" ? "list" : "grid"

  const [products, counts] = await Promise.all([
    listProducts({
      q,
      status: status as ProductStatus | "ALL",
    }),
    countProductsByStatus(q),
  ])

  const filteredEmpty =
    products.length === 0 && (q.length > 0 || status !== "ALL")

  return (
    <CatalogView q={q} status={status} view={view} counts={counts}>
      {products.length === 0 ? (
        filteredEmpty ? (
          <CatalogEmpty view={view} />
        ) : (
          <div className="flex flex-col items-center gap-3 px-1 py-16 text-center">
            <p className="text-sm text-muted-foreground">
              Aún no hay productos.
            </p>
            <Button
              className="h-11"
              nativeButton={false}
              render={<Link href="/products/new" />}
            >
              + Subir producto
            </Button>
          </div>
        )
      ) : view === "grid" ? (
        <div className="grid auto-rows-fr grid-cols-2 items-stretch gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {products.map((product, index) => (
            <ProductCard
              key={product.id}
              product={product}
              view="grid"
              priority={index === 0}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {products.map((product, index) => (
            <ProductCard
              key={product.id}
              product={product}
              view="list"
              priority={index === 0}
            />
          ))}
        </div>
      )}
    </CatalogView>
  )
}
