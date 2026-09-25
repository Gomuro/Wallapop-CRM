import type { ApiCategory } from "@/lib/api/types"
import { conditionLabel } from "@/lib/inventory/conditions"
import type { InventoryProduct, StatusCounts } from "@/lib/inventory/types"
import type { ProductStatus } from "@/lib/validations"

import type { OfflineProductDraft } from "./types"

const PRODUCTS_KEY = "wallapop-crm.offline.products"
const CATEGORIES_KEY = "wallapop-crm.offline.categories"

const memory: {
  products: InventoryProduct[] | null
  categories: ApiCategory[] | null
} = {
  products: null,
  categories: null,
}

export const OFFLINE_CATEGORIES: ApiCategory[] = [
  {
    id: "offline-root",
    wallapopId: 1,
    parentId: null,
    slug: "general",
    nameEs: "General",
    nameUk: "Загальне",
    isLeaf: false,
    leafSelectionMandatory: true,
    depth: 1,
    path: "1/",
    sortOrder: 0,
  },
  {
    id: "offline-other",
    wallapopId: 2,
    parentId: "offline-root",
    slug: "otros",
    nameEs: "Otros",
    nameUk: "Інше",
    isLeaf: true,
    leafSelectionMandatory: false,
    depth: 2,
    path: "1/2/",
    sortOrder: 0,
  },
]

export class OfflineSkuError extends Error {
  constructor() {
    super("Ese SKU ya existe.")
    this.name = "OfflineSkuError"
  }
}

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

const CACHE_EVENT = "wallapop-offline-cache"

let productsSnapshot = "[]"
let categoriesSnapshot = ""

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Quota or private mode: keep the in-memory copy for this tab.
  }
}

function notifyCache() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event(CACHE_EVENT))
}

export function subscribeOfflineCache(onChange: () => void) {
  window.addEventListener(CACHE_EVENT, onChange)
  window.addEventListener("storage", onChange)
  return () => {
    window.removeEventListener(CACHE_EVENT, onChange)
    window.removeEventListener("storage", onChange)
  }
}

export function getOfflineProductsSnapshot(): string {
  if (typeof window === "undefined") return productsSnapshot
  try {
    const raw = window.localStorage.getItem(PRODUCTS_KEY) ?? "[]"
    if (raw !== productsSnapshot) productsSnapshot = raw
  } catch {
    // Keep the last snapshot.
  }
  return productsSnapshot
}

export function getOfflineProductsServerSnapshot(): string {
  return ""
}

export function getOfflineCategoriesSnapshot(): string {
  if (typeof window === "undefined") return JSON.stringify(OFFLINE_CATEGORIES)
  try {
    const raw = window.localStorage.getItem(CATEGORIES_KEY)
    const next = raw && raw !== "[]" ? raw : JSON.stringify(OFFLINE_CATEGORIES)
    if (next !== categoriesSnapshot) categoriesSnapshot = next
  } catch {
    if (!categoriesSnapshot) categoriesSnapshot = JSON.stringify(OFFLINE_CATEGORIES)
  }
  return categoriesSnapshot || JSON.stringify(OFFLINE_CATEGORIES)
}

export function getOfflineCategoriesServerSnapshot(): string {
  return JSON.stringify(OFFLINE_CATEGORIES)
}

export function readOfflineProducts(): InventoryProduct[] {
  if (memory.products) return memory.products
  const stored = readJson<InventoryProduct[]>(PRODUCTS_KEY)
  memory.products = Array.isArray(stored) ? stored : []
  return memory.products
}

export function writeOfflineProducts(products: InventoryProduct[]) {
  memory.products = products
  productsSnapshot = JSON.stringify(products)
  writeJson(PRODUCTS_KEY, products)
  notifyCache()
}

function mergeProduct(
  prev: InventoryProduct | undefined,
  next: InventoryProduct,
): InventoryProduct {
  if (!prev) return next
  return {
    ...next,
    description: next.description || prev.description,
    category: next.category || prev.category,
    condition: next.condition || prev.condition,
    conditionCode: next.condition ? next.conditionCode : prev.conditionCode,
    images: next.images.length > 0 ? next.images : prev.images,
    productImages:
      next.productImages.length > 0 ? next.productImages : prev.productImages,
    listing: next.listing ?? prev.listing,
    weight: next.weight ?? prev.weight,
    listingActive: next.listingActive ?? prev.listingActive,
  }
}

export function rememberOfflineProducts(products: InventoryProduct[]) {
  const local = readOfflineProducts()
  const byId = new Map(local.map((product) => [product.id, product]))
  const merged = products.map((product) => mergeProduct(byId.get(product.id), product))
  const incoming = new Set(merged.map((product) => product.id))
  const pending = local.filter(
    (product) => product.id.startsWith("offline_") && !incoming.has(product.id),
  )
  writeOfflineProducts([...merged, ...pending])
}

export function rememberOfflineCategories(categories: ApiCategory[]) {
  if (categories.length === 0) return
  memory.categories = categories
  categoriesSnapshot = JSON.stringify(categories)
  writeJson(CATEGORIES_KEY, categories)
  notifyCache()
}

export function readOfflineCategories(): ApiCategory[] {
  if (memory.categories && memory.categories.length > 0) return memory.categories
  const stored = readJson<ApiCategory[]>(CATEGORIES_KEY)
  if (Array.isArray(stored) && stored.length > 0) {
    memory.categories = stored
    return stored
  }
  return OFFLINE_CATEGORIES
}

export function getOfflineProduct(id: string): InventoryProduct | null {
  return readOfflineProducts().find((product) => product.id === id) ?? null
}

export function upsertOfflineProduct(
  draft: OfflineProductDraft,
  categories: ApiCategory[] = readOfflineCategories(),
): InventoryProduct {
  const products = readOfflineProducts()
  const id = draft.id ?? `offline_${crypto.randomUUID()}`
  const skuTaken = products.some(
    (product) =>
      product.id !== id && product.sku.toLowerCase() === draft.sku.toLowerCase(),
  )
  if (skuTaken) throw new OfflineSkuError()

  const prev = products.find((product) => product.id === id)
  const category = categories.find((item) => item.id === draft.categoryId)
  const now = new Date().toISOString()
  const images = draft.images ?? prev?.images ?? []
  const next: InventoryProduct = {
    id,
    sku: draft.sku,
    title: draft.title,
    description: draft.description,
    price: draft.price,
    categoryId: draft.categoryId,
    category: category?.nameEs ?? prev?.category ?? "",
    condition: conditionLabel(draft.condition),
    conditionCode: draft.condition,
    weight: draft.weight === undefined ? (prev?.weight ?? null) : draft.weight,
    images,
    productImages:
      images === prev?.images
        ? (prev?.productImages ?? [])
        : images.map((url, index) => ({
            id: `${id}-img-${index}`,
            url,
            sortOrder: index,
          })),
    status: draft.status,
    externalLinks: prev?.externalLinks ?? [],
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    listing: prev?.listing ?? null,
    listingActive: prev?.listingActive,
  }

  writeOfflineProducts([next, ...products.filter((product) => product.id !== id)])
  return next
}

export function markOfflineProductSold(id: string): InventoryProduct | null {
  const current = getOfflineProduct(id)
  if (!current || current.status === "SOLD") return current
  return upsertOfflineProduct(
    {
      id: current.id,
      sku: current.sku,
      title: current.title,
      description: current.description,
      price: current.price,
      categoryId: current.categoryId,
      condition: current.conditionCode,
      weight: current.weight,
      status: "SOLD",
      images: current.images,
    },
    readOfflineCategories(),
  )
}

export function deleteOfflineProduct(id: string): void {
  writeOfflineProducts(readOfflineProducts().filter((product) => product.id !== id))
}

export function filterOfflineProducts(
  products: InventoryProduct[],
  query: { q?: string; status?: ProductStatus | "ALL" },
): InventoryProduct[] {
  const q = query.q?.trim().toLowerCase() ?? ""
  return products.filter((product) => {
    if (query.status && query.status !== "ALL" && product.status !== query.status) {
      return false
    }
    if (!q) return true
    return (
      product.title.toLowerCase().includes(q) ||
      product.sku.toLowerCase().includes(q) ||
      product.description.toLowerCase().includes(q)
    )
  })
}

export function offlineStatusCounts(
  products: InventoryProduct[],
  q?: string,
): StatusCounts {
  const matched = filterOfflineProducts(products, { q, status: "ALL" })
  return {
    ALL: matched.length,
    ACTIVE: matched.filter((product) => product.status === "ACTIVE").length,
    SOLD: matched.filter((product) => product.status === "SOLD").length,
    INACTIVE: matched.filter((product) => product.status === "INACTIVE").length,
  }
}
