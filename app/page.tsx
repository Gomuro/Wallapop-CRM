export const dynamic = "force-dynamic"

import { ApiUnavailable } from "@/components/api/api-unavailable"
import { CatalogEmpty } from "@/components/catalog/catalog-empty"
import { CatalogProductList } from "@/components/catalog/catalog-product-list"
import { CatalogView } from "@/components/catalog/catalog-view"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { apiUnavailableReason } from "@/lib/api/availability"
import { isApiConfigured } from "@/lib/api/config"
import { countProductsByStatus, listProductPage } from "@/lib/inventory/store"
import {
  CATALOG_PAGE_SIZE,
  type CatalogListingFilter,
  type InventoryProduct,
  type StatusCounts,
} from "@/lib/inventory/types"
import { catalogListingFilterSchema, type ProductStatus } from "@/lib/validations"

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string
    status?: string
    view?: string
    listing?: string
  }>
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
  const listingParsed = catalogListingFilterSchema.safeParse(
    firstParam(params.listing),
  )
  const listing: CatalogListingFilter | undefined = listingParsed.success
    ? listingParsed.data
    : undefined
  const view = firstParam(params.view) === "list" ? "list" : "grid"

  if (!isApiConfigured()) {
    return <ApiUnavailable reason="config" />
  }

  let products: InventoryProduct[]
  let total = 0
  let counts: StatusCounts
  try {
    const [pageResult, statusCounts] = await Promise.all([
      listProductPage({
        q,
        status: status as ProductStatus | "ALL",
        listing,
        page: 1,
        pageSize: CATALOG_PAGE_SIZE,
      }),
      countProductsByStatus(q),
    ])
    products = pageResult.products
    total = pageResult.total
    counts = statusCounts
  } catch (error) {
    const reason = apiUnavailableReason(error) ?? "unreachable"
    return <ApiUnavailable reason={reason} />
  }

  const filteredEmpty =
    products.length === 0 && (q.length > 0 || status !== "ALL" || listing != null)

  return (
    <CatalogView q={q} status={status} listing={listing} view={view} counts={counts}>
      {products.length === 0 ? (
        filteredEmpty ? (
          <CatalogEmpty view={view} />
        ) : (
          <div className="flex flex-col items-center gap-3 px-1 py-16 text-center">
            <p className="text-sm text-muted-foreground">Aún no hay productos.</p>
            <Button
              className="h-11"
              nativeButton={false}
              render={<Link href="/products/new" />}
            >
              + Subir producto
            </Button>
          </div>
        )
      ) : (
        <CatalogProductList
          key={`${q}|${status}|${listing ?? ""}`}
          initialProducts={products}
          total={total}
          q={q}
          status={status}
          listing={listing}
          view={view}
        />
      )}
    </CatalogView>
  )
}
