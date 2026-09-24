import Link from "next/link"

import { CatalogToolbar } from "@/components/catalog/catalog-toolbar"
import { ProductCard } from "@/components/catalog/product-card"
import { PageContainer } from "@/components/shell/page-container"
import { Button } from "@/components/ui/button"
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

  const products = await listProducts({
    q,
    status: status as ProductStatus | "ALL",
  })

  return (
    <>
      <CatalogToolbar q={q} status={status} view={view} />
      <PageContainer className="flex-1 py-3">
        {products.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-1 py-16 text-center">
            <p className="text-sm text-muted-foreground">
              {q || status !== "ALL"
                ? "No items match this search."
                : "No items yet."}
            </p>
            {!q && status === "ALL" ? (
              <Button
                className="h-11"
                nativeButton={false}
                render={<Link href="/products/new" />}
              >
                New item
              </Button>
            ) : null}
          </div>
        ) : view === "grid" ? (
          <div className="grid auto-rows-fr grid-cols-2 items-stretch gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
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
      </PageContainer>
    </>
  )
}
