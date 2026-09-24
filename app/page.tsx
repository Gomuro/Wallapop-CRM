import { CatalogToolbar } from "@/components/catalog/catalog-toolbar"
import { ProductCard } from "@/components/catalog/product-card"
import { listProducts } from "@/lib/inventory/store"
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
  const q = firstParam(params.q) ?? ""
  const statusParam = firstParam(params.status) ?? "ALL"
  const status =
    statusParam === "ACTIVE" ||
    statusParam === "SOLD" ||
    statusParam === "INACTIVE"
      ? statusParam
      : "ALL"
  const view = firstParam(params.view) === "list" ? "list" : "grid"

  const products = listProducts({
    q,
    status: status as ProductStatus | "ALL",
  })

  return (
    <>
      <CatalogToolbar q={q} status={status} view={view} />
      <main className="flex-1 px-4 py-3">
        {products.length === 0 ? (
          <p className="px-1 py-10 text-center text-sm text-muted-foreground">
            No items match this search.
          </p>
        ) : view === "grid" ? (
          <div className="grid grid-cols-2 gap-2">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} view="grid" />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} view="list" />
            ))}
          </div>
        )}
      </main>
    </>
  )
}
