"use client"

import Link from "next/link"
import { useEffect, useMemo } from "react"

import { CatalogEmpty } from "@/components/catalog/catalog-empty"
import { CatalogProductList } from "@/components/catalog/catalog-product-list"
import { CatalogView } from "@/components/catalog/catalog-view"
import { OfflineBanner } from "@/components/offline/offline-banner"
import { Button } from "@/components/ui/button"
import {
  filterOfflineProducts,
  offlineStatusCounts,
  rememberOfflineProducts,
} from "@/lib/offline/cache"
import { useOfflineProducts } from "@/lib/offline/use-offline-cache"
import type { InventoryProduct, StatusCounts } from "@/lib/inventory/types"
import type { ProductStatus } from "@/lib/validations"

const EMPTY_COUNTS: StatusCounts = {
  ALL: 0,
  ACTIVE: 0,
  SOLD: 0,
  INACTIVE: 0,
}

export function OfflineCatalog({
  offline,
  serverProducts,
  serverCounts,
  q,
  status,
  view,
}: {
  offline: boolean
  serverProducts: InventoryProduct[]
  serverCounts: StatusCounts
  q: string
  status: "ALL" | ProductStatus
  view: "grid" | "list"
}) {
  const local = useOfflineProducts()

  useEffect(() => {
    if (!offline) rememberOfflineProducts(serverProducts)
  }, [offline, serverProducts])

  const pending = useMemo(() => {
    return (local ?? []).filter(
      (product) =>
        product.id.startsWith("offline_") &&
        !serverProducts.some((row) => row.id === product.id),
    )
  }, [local, serverProducts])

  const products = useMemo(() => {
    if (offline) return filterOfflineProducts(local ?? [], { q, status })
    return [
      ...serverProducts,
      ...filterOfflineProducts(pending, { q, status }),
    ]
  }, [local, offline, pending, q, serverProducts, status])

  const pendingCounts = offlineStatusCounts(pending, q)
  const counts = offline
    ? local
      ? offlineStatusCounts(local, q)
      : EMPTY_COUNTS
    : {
        ALL: serverCounts.ALL + pendingCounts.ALL,
        ACTIVE: serverCounts.ACTIVE + pendingCounts.ACTIVE,
        SOLD: serverCounts.SOLD + pendingCounts.SOLD,
        INACTIVE: serverCounts.INACTIVE + pendingCounts.INACTIVE,
      }

  const filteredEmpty =
    products.length === 0 && (q.length > 0 || status !== "ALL")
  const showEmpty = products.length === 0 && (offline ? local !== null : true)

  return (
    <>
      {offline ? <OfflineBanner /> : null}
      <CatalogView q={q} status={status} view={view} counts={counts}>
        {showEmpty ? (
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
            key={`${offline ? "off" : "on"}|${q}|${status}`}
            initialProducts={offline ? products : serverProducts}
            total={offline ? products.length : counts[status]}
            q={q}
            status={status}
            view={view}
            extraProducts={offline ? [] : pending}
          />
        )}
      </CatalogView>
    </>
  )
}
