"use client"

import { useEffect, useRef, useState } from "react"
import { LoaderCircleIcon } from "lucide-react"

import { loadCatalogPage } from "@/app/actions/products"
import { ProductCard } from "@/components/catalog/product-card"
import { CatalogDeletePack } from "@/components/catalog/catalog-delete-pack"
import { rememberOfflineProducts } from "@/lib/offline/cache"
import { CATALOG_PAGE_SIZE } from "@/lib/inventory/types"
import type { CatalogListingFilter, InventoryProduct } from "@/lib/inventory/types"
import type { ProductStatus } from "@/lib/validations"

function mergeUnique(
  current: InventoryProduct[],
  incoming: InventoryProduct[],
) {
  const ids = new Set(current.map((product) => product.id))
  const extra = incoming.filter((product) => !ids.has(product.id))
  return extra.length > 0 ? [...current, ...extra] : current
}

function toggleId(selected: Set<string>, id: string) {
  const next = new Set(selected)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

function CatalogMoreStatus({
  loading,
  error,
  onRetry,
}: {
  loading: boolean
  error: string | null
  onRetry: () => void
}) {
  if (loading) {
    return (
      <p
        className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground"
        aria-live="polite"
      >
        <LoaderCircleIcon className="size-4 animate-spin" />
        Cargando más…
      </p>
    )
  }
  if (!error) return null
  return (
    <div className="flex flex-col items-center gap-2 py-3" role="alert">
      <p className="text-sm text-destructive">{error}</p>
      <button
        type="button"
        className="h-11 rounded-full bg-muted px-4 text-sm font-semibold"
        onClick={onRetry}
      >
        Reintentar
      </button>
    </div>
  )
}

function CatalogProductGrid({
  products,
  view,
  selecting,
  selected,
  focusAccountId,
  onToggle,
  onHold,
}: {
  products: InventoryProduct[]
  view: "grid" | "list"
  selecting: boolean
  selected: Set<string>
  focusAccountId: string | null
  onToggle: (id: string) => void
  onHold: (id: string) => void
}) {
  if (view === "grid") {
    return (
      <div className="grid auto-rows-fr grid-cols-2 items-stretch gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {products.map((product, index) => (
          <ProductCard
            key={product.id}
            product={product}
            view="grid"
            priority={index === 0}
            selecting={selecting}
            selected={selected.has(product.id)}
            focusAccountId={focusAccountId}
            onToggle={() => onToggle(product.id)}
            onHold={() => onHold(product.id)}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {products.map((product, index) => (
        <ProductCard
          key={product.id}
          product={product}
          view="list"
          priority={index === 0}
          selecting={selecting}
          selected={selected.has(product.id)}
          focusAccountId={focusAccountId}
          onToggle={() => onToggle(product.id)}
          onHold={() => onHold(product.id)}
        />
      ))}
    </div>
  )
}

export function CatalogProductList({
  initialProducts,
  total,
  q,
  status,
  listing,
  view,
  extraProducts = [],
}: {
  initialProducts: InventoryProduct[]
  total: number
  q: string
  status: "ALL" | ProductStatus
  listing?: CatalogListingFilter
  view: "grid" | "list"
  extraProducts?: InventoryProduct[]
}) {
  const [items, setItems] = useState(initialProducts)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(initialProducts.length >= total)
  const [error, setError] = useState<string | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [queueAccountId, setQueueAccountId] = useState<string | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const inFlight = useRef(false)
  const generation = useRef(0)

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
        void loadCatalogPage({ page: nextPage, q, status, listing })
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
  }, [hasMore, loading, error, page, q, status, listing])

  return (
    <CatalogDeletePack
      products={displayed}
      selecting={selecting}
      selected={selected}
      queueAccountId={queueAccountId}
      onQueueAccountId={setQueueAccountId}
      onSelectingChange={setSelecting}
      onSelectedChange={setSelected}
      onRemoved={(ids) => {
        setItems((prev) => prev.filter((product) => !ids.includes(product.id)))
      }}
      onQueued={(ids, accountId) => {
        const queued = new Set(ids)
        setItems((prev) =>
          prev.map((product) => {
            if (!queued.has(product.id)) return product
            return {
              ...product,
              accountStates: product.accountStates?.map((state) =>
                state.accountId === accountId
                  ? { ...state, status: "READY_TO_POST", externalUrl: null }
                  : state,
              ),
            }
          }),
        )
      }}
    >
      <CatalogProductGrid
        products={displayed}
        view={view}
        selecting={selecting}
        selected={selected}
        focusAccountId={queueAccountId}
        onToggle={(id) =>
          setSelected((prev) => {
            const next = toggleId(prev, id)
            if (next.size === 0) setSelecting(false)
            return next
          })
        }
        onHold={(id) => {
          setSelecting(true)
          setSelected(new Set([id]))
        }}
      />
      {hasMore ? <div ref={sentinelRef} className="h-8" aria-hidden /> : null}
      <CatalogMoreStatus
        loading={loading}
        error={error}
        onRetry={() => setError(null)}
      />
    </CatalogDeletePack>
  )
}
