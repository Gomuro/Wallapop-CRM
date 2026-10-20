import { resolveMediaUrl } from "@/lib/api/config"
import type { ApiProduct, ApiProductImage } from "@/lib/api/types"

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

export function normalizeImages(images: unknown): ApiProductImage[] {
  if (!Array.isArray(images)) return []
  const out: ApiProductImage[] = []
  for (const [index, item] of images.entries()) {
    if (typeof item === "string" && item.trim()) {
      out.push({ id: `img-${index}`, url: item.trim(), sortOrder: index })
      continue
    }
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const url = asString(row.url).trim()
    if (!url) continue
    out.push({
      id: asString(row.id, `img-${index}`),
      url,
      storageKey: typeof row.storageKey === "string" ? row.storageKey : undefined,
      sortOrder: asNumber(row.sortOrder, index),
    })
  }
  return out
}

export function productImageUrls(product: ApiProduct): string[] {
  return normalizeImages(product?.images)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((image) => resolveMediaUrl(image.url))
    .filter(Boolean)
}

export function mappedProductImages(product: ApiProduct) {
  return normalizeImages(product?.images).map((image) => ({
    id: image.id,
    url: resolveMediaUrl(image.url),
    sortOrder: image.sortOrder,
  }))
}
