"use client"

import Link from "next/link"
import { useEffect, useMemo } from "react"

import { CatalogEmpty } from "@/components/catalog/catalog-empty"
import { CatalogView } from "@/components/catalog/catalog-view"
import { ProductCard } from "@/components/catalog/product-card"
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
    </>
  )
}
