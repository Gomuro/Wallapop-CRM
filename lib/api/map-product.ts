import { resolveMediaUrl } from "@/lib/api/config"
import type {
  ApiCategory,
  ApiListing,
  ApiProduct,
  ApiProductImage,
  ApiProductListItem,
} from "@/lib/api/types"
import {
  conditionFromFormValue,
  conditionLabel,
} from "@/lib/inventory/conditions"
import type { InventoryListing, InventoryProduct } from "@/lib/inventory/types"
import type { ListingStatus, ProductCondition, ProductStatus } from "@/lib/validations"

const PRODUCT_STATUSES = new Set<ProductStatus>(["ACTIVE", "SOLD", "INACTIVE"])
const LISTING_STATUSES = new Set<ListingStatus>([
  "ACTIVE",
  "DEACTIVATED",
  "READY_TO_POST",
])

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

function asNullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null
  const parsed = asNumber(value, Number.NaN)
  return Number.isFinite(parsed) ? parsed : null
}

function asStatus(value: unknown): ProductStatus {
  return typeof value === "string" && PRODUCT_STATUSES.has(value as ProductStatus)
    ? (value as ProductStatus)
    : "ACTIVE"
}

function asListingStatus(value: unknown): ListingStatus {
  return typeof value === "string" && LISTING_STATUSES.has(value as ListingStatus)
    ? (value as ListingStatus)
    : "READY_TO_POST"
}

function asCondition(value: unknown): ProductCondition {
  return conditionFromFormValue(typeof value === "string" ? value : "GOOD")
}

function normalizeImages(images: unknown): ApiProductImage[] {
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

export function mapApiListing(
  listing: ApiListing | null | undefined,
  accountName: string,
): InventoryListing | null {
  if (!listing || typeof listing !== "object") return null
  const id = asString(listing.id)
  if (!id) return null
  return {
    id,
    accountId: asString(listing.accountId),
    accountName,
    externalUrl:
      typeof listing.externalUrl === "string" && listing.externalUrl.trim()
        ? listing.externalUrl
        : null,
    status: asListingStatus(listing.status),
  }
}

export function mapListItemToInventory(row: ApiProductListItem): InventoryProduct {
  const cover =
    typeof row.coverUrl === "string" && row.coverUrl.trim()
      ? resolveMediaUrl(row.coverUrl)
      : ""

  return {
    id: asString(row.id),
    sku: asString(row.sku),
    title: asString(row.title),
    description: "",
    price: asNumber(row.price),
    categoryId: asString(row.categoryId),
    category: "",
    condition: "",
    conditionCode: "GOOD",
    weight: null,
    images: cover ? [cover] : [],
    productImages: [],
    status: asStatus(row.status),
    externalLinks: [],
    createdAt: asString(row.updatedAt),
    updatedAt: asString(row.updatedAt),
    listing: null,
    listingActive: Boolean(row.listingActive),
  }
}

export function mapProductToInventory(
  product: ApiProduct,
  category: ApiCategory | null,
  accountName: string,
): InventoryProduct {
  const images = normalizeImages(product?.images)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((image) => resolveMediaUrl(image.url))
    .filter(Boolean)

  const listing = mapApiListing(product?.listing, accountName)
  const conditionCode = asCondition(product?.condition)

  return {
    id: asString(product?.id),
    sku: asString(product?.sku),
    title: asString(product?.title),
    description: asString(product?.description),
    price: asNumber(product?.price),
    categoryId: asString(product?.categoryId),
    category: category?.nameEs ?? category?.nameUk ?? asString(product?.categoryId),
    condition: conditionLabel(conditionCode),
    conditionCode,
    weight: asNullableNumber(product?.weightKg),
    images,
    productImages: normalizeImages(product?.images).map((image) => ({
      id: image.id,
      url: resolveMediaUrl(image.url),
      sortOrder: image.sortOrder,
    })),
    status: asStatus(product?.status),
    externalLinks: listing?.externalUrl ? [listing.externalUrl] : [],
    createdAt: asString(product?.createdAt),
    updatedAt: asString(product?.updatedAt),
    listing,
    listingActive: listing?.status === "ACTIVE",
  }
}
