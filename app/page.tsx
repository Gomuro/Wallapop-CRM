export const dynamic = "force-dynamic"

import { ApiUnavailable } from "@/components/api/api-unavailable"
import { OfflineCatalog } from "@/components/offline/offline-catalog"
import { apiUnavailableReason, isTransportFailure } from "@/lib/api/availability"
import { isApiConfigured } from "@/lib/api/config"
import { countProductsByStatus, listProducts } from "@/lib/inventory/store"
import type { InventoryProduct, StatusCounts } from "@/lib/inventory/types"
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

  if (!isApiConfigured()) {
    return <ApiUnavailable reason="config" />
  }

  const emptyCounts: StatusCounts = {
    ALL: 0,
    ACTIVE: 0,
    SOLD: 0,
    INACTIVE: 0,
  }
  let products: InventoryProduct[] = []
  let counts: StatusCounts = emptyCounts
  let offline = false
  try {
    ;[products, counts] = await Promise.all([
      listProducts({
        q,
        status: status as ProductStatus | "ALL",
      }),
      countProductsByStatus(q),
    ])
  } catch (error) {
    if (!isTransportFailure(error)) {
      const reason = apiUnavailableReason(error) ?? "unreachable"
      return <ApiUnavailable reason={reason} />
    }
    offline = true
  }

  return (
    <OfflineCatalog
      offline={offline}
      serverProducts={offline ? [] : products}
      serverCounts={offline ? emptyCounts : counts}
      q={q}
      status={status}
      view={view}
    />
  )
}
