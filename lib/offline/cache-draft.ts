import type { ApiCategory } from "@/lib/api/types"
import { conditionLabel } from "@/lib/inventory/conditions"
import { isShippingPublishReady } from "@/lib/inventory/shipping-for-publish"
import type { InventoryProduct } from "@/lib/inventory/types"

import {
  readOfflineCategories,
  readOfflineProducts,
  writeOfflineProducts,
} from "./cache"
import type { OfflineProductDraft } from "./types"

export class OfflineSkuError extends Error {
  constructor() {
    super("Ese SKU ya existe.")
    this.name = "OfflineSkuError"
  }
}

export function assertOfflineSkuFree(
  products: InventoryProduct[],
  id: string,
  sku: string,
) {
  const taken = products.some(
    (product) =>
      product.id !== id && product.sku.toLowerCase() === sku.toLowerCase(),
  )
  if (taken) throw new OfflineSkuError()
}

function pickDraftMeasure(
  draftValue: number | null | undefined,
  prevValue: number | null | undefined,
) {
  return draftValue === undefined ? (prevValue ?? null) : draftValue
}

export function draftMeasures(
  draft: OfflineProductDraft,
  prev: InventoryProduct | undefined,
) {
  return {
    weight: pickDraftMeasure(draft.weight, prev?.weight),
    widthCm: pickDraftMeasure(draft.widthCm, prev?.widthCm),
    lengthCm: pickDraftMeasure(draft.lengthCm, prev?.lengthCm),
    heightCm: pickDraftMeasure(draft.heightCm, prev?.heightCm),
  }
}

export function productImagesFromDraftUrls(
  id: string,
  images: string[],
  prev: InventoryProduct | undefined,
) {
  if (images === prev?.images) return prev?.productImages ?? []
  return images.map((url, index) => ({
    id: `${id}-img-${index}`,
    url,
    sortOrder: index,
  }))
}

function draftShippingPackageSize(
  draft: OfflineProductDraft,
  prev: InventoryProduct | undefined,
) {
  if (draft.shippingPackageSize === undefined) {
    return prev?.shippingPackageSize ?? "STANDARD"
  }
  return draft.shippingPackageSize
}

function draftListingMeta(
  prev: InventoryProduct | undefined,
  weight: number | null,
) {
  return {
    listing: prev?.listing ?? null,
    typeAttributes: prev?.typeAttributes ?? {},
    listingActive: prev?.listingActive,
    shippingPublishReady: isShippingPublishReady({
      weightKg: weight,
      shippingEnabled: prev?.listing?.shippingEnabled,
    }),
  }
}

export function inventoryFromOfflineDraft(input: {
  draft: OfflineProductDraft
  prev: InventoryProduct | undefined
  category: ApiCategory | undefined
  id: string
  now: string
}): InventoryProduct {
  const { draft, prev, category, id, now } = input
  const images = draft.images ?? prev?.images ?? []
  const measures = draftMeasures(draft, prev)
  return {
    id,
    sku: draft.sku,
    title: draft.title,
    description: draft.description,
    price: draft.price,
    categoryId: draft.categoryId,
    category: category?.nameEs ?? prev?.category ?? "",
    condition: conditionLabel(draft.condition),
    conditionCode: draft.condition,
    brand: prev?.brand ?? null,
    ...measures,
    shippingPackageSize: draftShippingPackageSize(draft, prev),
    images,
    productImages: productImagesFromDraftUrls(id, images, prev),
    status: draft.status,
    externalLinks: prev?.externalLinks ?? [],
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    ...draftListingMeta(prev, measures.weight),
  }
}

export function upsertOfflineProduct(
  draft: OfflineProductDraft,
  categories: ApiCategory[] = readOfflineCategories(),
): InventoryProduct {
  const products = readOfflineProducts()
  const id = draft.id ?? `offline_${crypto.randomUUID()}`
  assertOfflineSkuFree(products, id, draft.sku)
  const prev = products.find((product) => product.id === id)
  const next = inventoryFromOfflineDraft({
    draft,
    prev,
    category: categories.find((item) => item.id === draft.categoryId),
    id,
    now: new Date().toISOString(),
  })
  writeOfflineProducts([next, ...products.filter((product) => product.id !== id)])
  return next
}
