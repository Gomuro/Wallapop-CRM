"use client"

import { useEffect, useRef, useState } from "react"
import { LoaderCircleIcon } from "lucide-react"

import { loadCatalogPage } from "@/app/actions/products"
import { ProductCard } from "@/components/catalog/product-card"
import { rememberOfflineProducts } from "@/lib/offline/cache"
import { CATALOG_PAGE_SIZE } from "@/lib/inventory/types"
import type { InventoryProduct } from "@/lib/inventory/types"
import type { ProductStatus } from "@/lib/validations"

function mergeUnique(
  current: InventoryProduct[],
  incoming: InventoryProduct[],
) {
  const ids = new Set(current.map((product) => product.id))
  const extra = incoming.filter((product) => !ids.has(product.id))
  return extra.length > 0 ? [...current, ...extra] : current
}

export function CatalogProductList({
  initialProducts,
  total,
  q,
  status,
  view,
  extraProducts = [],
}: {
  initialProducts: InventoryProduct[]
  total: number
  q: string
  status: "ALL" | ProductStatus
  view: "grid" | "list"
  extraProducts?: InventoryProduct[]
}) {
  const [items, setItems] = useState(initialProducts)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(initialProducts.length >= total)
  const [error, setError] = useState<string | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const inFlight = useRef(false)
  const generation = useRef(0)

  useEffect(() => {
    generation.current += 1
    setItems(initialProducts)
    setPage(1)
    setDone(initialProducts.length >= total)
    setError(null)
    inFlight.current = false
  }, [initialProducts, q, status, total])

  useEffect(() => {
    rememberOfflineProducts(items)
  }, [items])

  const displayed = mergeUnique(items, extraProducts)
  const hasMore = !done && items.length < total

  useEffect(() => {
    if (!hasMore || loading || error) return
    const node = sentinelRef.current
    if (!node) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || inFlight.current) return
        const nextPage = page + 1
        const gen = generation.current
        inFlight.current = true
        setLoading(true)
        void loadCatalogPage({ page: nextPage, q, status })
          .then((result) => {
            if (gen !== generation.current) return
            inFlight.current = false
            setLoading(false)
            if (!result.ok) {
              setError(result.error)
              return
            }
            if (result.products.length === 0) {
              setDone(true)
              return
            }
            setPage(result.page)
            let nextLength = 0
            setItems((prev) => {
              const next = mergeUnique(prev, result.products)
              nextLength = next.length
              return next
            })
            if (
              nextLength >= result.total ||
              result.products.length < CATALOG_PAGE_SIZE
            ) {
              setDone(true)
            }
          })
          .catch(() => {
            if (gen !== generation.current) return
            inFlight.current = false
            setLoading(false)
            setError("No se han podido cargar más productos.")
          })
      },
      { rootMargin: "240px 0px" },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, loading, error, page, q, status])

  return (
    <>
      {view === "grid" ? (
        <div className="grid auto-rows-fr grid-cols-2 items-stretch gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {displayed.map((product, index) => (
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
          {displayed.map((product, index) => (
            <ProductCard
              key={product.id}
              product={product}
              view="list"
              priority={index === 0}
            />
          ))}
        </div>
      )}
      {hasMore ? <div ref={sentinelRef} className="h-8" aria-hidden /> : null}
      {loading ? (
        <p
          className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground"
          aria-live="polite"
        >
          <LoaderCircleIcon className="size-4 animate-spin" />
          Cargando más…
        </p>
      ) : null}
      {error ? (
        <div className="flex flex-col items-center gap-2 py-3" role="alert">
          <p className="text-sm text-destructive">{error}</p>
          <button
            type="button"
            className="h-11 rounded-full bg-muted px-4 text-sm font-semibold"
            onClick={() => setError(null)}
          >
            Reintentar
          </button>
        </div>
      ) : null}
    </>
  )
}
