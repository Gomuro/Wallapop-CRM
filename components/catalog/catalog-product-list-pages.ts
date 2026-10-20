import { loadCatalogPage } from "@/app/actions/products"
import { CATALOG_PAGE_SIZE } from "@/lib/inventory/types"
import type { CatalogListingFilter, InventoryProduct } from "@/lib/inventory/types"
import type { ProductStatus } from "@/lib/validations"

export function mergeUnique(current: InventoryProduct[], incoming: InventoryProduct[]) {
  const ids = new Set(current.map((product) => product.id))
  const extra = incoming.filter((product) => !ids.has(product.id))
  return extra.length > 0 ? [...current, ...extra] : current
}

type CatalogQuery = {
  q: string
  status: "ALL" | ProductStatus
  listing?: CatalogListingFilter
}

export type CatalogPageBatch = {
  items: InventoryProduct[]
  page: number
  done: boolean
  error: string | null
  aborted: boolean
}

export async function collectCatalogPages(input: {
  startItems: InventoryProduct[]
  startPage: number
  startDone: boolean
  total: number
  query: CatalogQuery
  isCurrent: () => boolean
}): Promise<CatalogPageBatch> {
  let collected = input.startItems
  let nextPage = input.startPage
  let finished = input.startDone || collected.length >= input.total
  while (!finished) {
    const step = await loadOneCatalogPage(collected, nextPage, input)
    if (step.stop) return step.batch
    collected = step.batch.items
    nextPage = step.batch.page
    finished = step.batch.done
  }
  return { items: collected, page: nextPage, done: finished, error: null, aborted: false }
}

async function loadOneCatalogPage(
  collected: InventoryProduct[],
  nextPage: number,
  input: {
    total: number
    query: CatalogQuery
    isCurrent: () => boolean
  },
): Promise<{ stop: boolean; batch: CatalogPageBatch }> {
  const result = await loadCatalogPage({ page: nextPage + 1, ...input.query })
  if (!input.isCurrent()) {
    return { stop: true, batch: pageBatch(collected, nextPage, false, true) }
  }
  if (!result.ok) {
    return {
      stop: true,
      batch: { ...pageBatch(collected, nextPage, false, false), error: result.error },
    }
  }
  if (result.products.length === 0) {
    return { stop: true, batch: pageBatch(collected, nextPage, true, false) }
  }
  const items = mergeUnique(collected, result.products)
  const done = items.length >= result.total || result.products.length < CATALOG_PAGE_SIZE
  return {
    stop: done,
    batch: { items, page: result.page, done, error: null, aborted: false },
  }
}

function pageBatch(
  items: InventoryProduct[],
  page: number,
  done: boolean,
  aborted: boolean,
): CatalogPageBatch {
  return { items, page, done, error: null, aborted }
}

type NextPageInput = {
  page: number
  query: CatalogQuery
  generation: number
  currentGeneration: () => number
  inFlight: { current: boolean }
  setLoading: (value: boolean) => void
  setError: (value: string | null) => void
  setDone: (value: boolean) => void
  setPage: (value: number) => void
  setItems: (update: (prev: InventoryProduct[]) => InventoryProduct[]) => void
}

export function requestNextCatalogPage(input: NextPageInput) {
  input.inFlight.current = true
  input.setLoading(true)
  void loadCatalogPage({ page: input.page + 1, ...input.query })
    .then((result) => applyNextCatalogPage(input, result))
    .catch(() => failNextCatalogPage(input))
}

function applyNextCatalogPage(
  input: NextPageInput,
  result: Awaited<ReturnType<typeof loadCatalogPage>>,
) {
  if (input.generation !== input.currentGeneration()) return
  input.inFlight.current = false
  input.setLoading(false)
  if (!result.ok) {
    input.setError(result.error)
    return
  }
  if (result.products.length === 0) {
    input.setDone(true)
    return
  }
  input.setPage(result.page)
  let nextLength = 0
  input.setItems((prev) => {
    const next = mergeUnique(prev, result.products)
    nextLength = next.length
    return next
  })
  if (nextLength >= result.total || result.products.length < CATALOG_PAGE_SIZE) {
    input.setDone(true)
  }
}

function failNextCatalogPage(input: NextPageInput) {
  if (input.generation !== input.currentGeneration()) return
  input.inFlight.current = false
  input.setLoading(false)
  input.setError("No se han podido cargar más productos.")
}
