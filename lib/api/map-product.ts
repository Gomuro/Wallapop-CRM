import { resolveMediaUrl } from "@/lib/api/config"
import { asDuplicateVariant } from "@/lib/api/map-variant"
import type {
  ApiAccountGlance,
  ApiCategory,
  ApiListing,
  ApiProduct,
  ApiProductListItem,
} from "@/lib/api/types"
import {
  mappedProductImages,
  productImageUrls,
} from "@/lib/api/map-product-images"
import {
  conditionFromFormValue,
  conditionLabel,
} from "@/lib/inventory/conditions"
import { computeListingActive } from "@/lib/inventory/listing-active"
import { isShippingPublishReady } from "@/lib/inventory/shipping-for-publish"
import type {
  AccountListingGlance,
  InventoryListing,
  InventoryProduct,
  ListingStatusRead,
} from "@/lib/inventory/types"
import type {
  ProductCondition,
  ProductStatus,
  ShippingPackageSize,
} from "@/lib/validations"

const PRODUCT_STATUSES = new Set<ProductStatus>(["ACTIVE", "SOLD", "INACTIVE"])
const LISTING_STATUSES = new Set<ListingStatusRead>([
  "ACTIVE",
  "RESERVED",
  "MISSING",
  "DEACTIVATED",
  "READY_TO_POST",
  "POSTING",
  "FAILED",
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

function mapAccountGlances(
  rows: ApiAccountGlance[] | null | undefined,
): AccountListingGlance[] | undefined {
  if (!rows) return undefined
  return rows.flatMap((row) => {
    const accountId = asString(row.accountId)
    const accountName = asString(row.accountName).trim()
    if (!accountId || !accountName) return []
    const status =
      typeof row.status === "string" &&
      LISTING_STATUSES.has(row.status as ListingStatusRead)
        ? (row.status as ListingStatusRead)
        : null
    return [
      {
        accountId,
        accountName,
        isDefault: row.isDefault === true,
        status,
        externalUrl:
          typeof row.externalUrl === "string" && row.externalUrl.trim()
            ? row.externalUrl
            : null,
        lastPublishError:
          typeof row.lastPublishError === "string" && row.lastPublishError.trim()
            ? row.lastPublishError
            : null,
      },
    ]
  })
}

function asTextOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

function asListingStatus(value: unknown): ListingStatusRead {
  return typeof value === "string" && LISTING_STATUSES.has(value as ListingStatusRead)
    ? (value as ListingStatusRead)
    : "READY_TO_POST"
}

function asCondition(value: unknown): ProductCondition {
  return conditionFromFormValue(typeof value === "string" ? value : "GOOD")
}

function asPackageSize(value: unknown): ShippingPackageSize | null {
  return value === "STANDARD" || value === "BULKY" ? value : null
}

export function mapApiListing(
  listing: ApiListing | null | undefined,
  accountName: string,
): InventoryListing | null {
  if (!listing || typeof listing !== "object") return null
  const id = asString(listing.id)
  if (!id) return null
  const named =
    typeof listing.accountName === "string" && listing.accountName.trim()
      ? listing.accountName.trim()
      : accountName
  return {
    id,
    accountId: asString(listing.accountId),
    accountName: named,
    isDefault: listing.isDefault === true,
    externalUrl:
      typeof listing.externalUrl === "string" && listing.externalUrl.trim()
        ? listing.externalUrl
        : null,
    status: asListingStatus(listing.status),
    lastPostedAt:
      typeof listing.lastPostedAt === "string" && listing.lastPostedAt.trim()
        ? listing.lastPostedAt
        : null,
    updatedAt:
      typeof listing.updatedAt === "string" && listing.updatedAt.trim()
        ? listing.updatedAt
        : null,
    lastPublishError: asTextOrNull(listing.lastPublishError),
    shippingEnabled: listing.shippingEnabled !== false,
    variant: asDuplicateVariant(listing.variant),
  }
}

export function listItemListing(
  row: ApiProductListItem,
): InventoryListing | null {
  const glance =
    row.accounts?.find((account) => account.isDefault) ?? row.accounts?.[0]
  return (
    mapApiListing(row.listing, glance?.accountName ?? "") ??
    (row.listingStatus != null
      ? {
          id: "",
          accountId: glance?.accountId ?? "",
          accountName: glance?.accountName,
          status: asListingStatus(row.listingStatus),
          externalUrl:
            typeof glance?.externalUrl === "string" && glance.externalUrl.trim()
              ? glance.externalUrl
              : null,
          lastPostedAt: row.lastPostedAt ?? null,
          updatedAt: row.listingUpdatedAt ?? null,
          shippingEnabled: true,
        }
      : null)
  )
}

function listItemListingActive(
  row: ApiProductListItem,
  listing: InventoryListing | null,
): boolean {
  if (listing?.status === "POSTING") return false
  if (listing?.id) return computeListingActive(listing)
  return Boolean(row.listingActive)
}

export function toListItemInventoryProduct(
  row: ApiProductListItem,
  cover: string,
  listing: InventoryListing | null,
): InventoryProduct {
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
    brand: null,
    weight: null,
    shippingPackageSize: null,
    widthCm: null,
    lengthCm: null,
    heightCm: null,
    images: cover ? [cover] : [],
    productImages: [],
    status: asStatus(row.status),
    externalLinks: [],
    createdAt: asString(row.updatedAt),
    updatedAt: asString(row.updatedAt),
    listing,
    accountStates: mapAccountGlances(row.accounts),
    typeAttributes: {},
    listingActive: listItemListingActive(row, listing),
    shippingPublishReady: row.shippingPublishReady === true,
  }
}

export function mapListItemToInventory(row: ApiProductListItem): InventoryProduct {
  const cover =
    typeof row.coverUrl === "string" && row.coverUrl.trim()
      ? resolveMediaUrl(row.coverUrl)
      : ""
  return toListItemInventoryProduct(row, cover, listItemListing(row))
}

type InventoryProductSource = {
  product: ApiProduct
  category: ApiCategory | null
  images: string[]
  listing: InventoryListing | null
  conditionCode: ProductCondition
}

function mapStoredListings(
  product: ApiProduct,
  listing: InventoryListing | null,
): InventoryListing[] {
  if (!Array.isArray(product.listings) || product.listings.length === 0) {
    return listing ? [listing] : []
  }
  const rows = product.listings
    .map((row) => mapApiListing(row, listing?.accountName ?? ""))
    .filter((row): row is InventoryListing => row != null)
  return rows.length > 0 ? rows : listing ? [listing] : []
}

function inventoryListingMeta(
  product: ApiProduct,
  listing: InventoryListing | null,
) {
  const weightKg = asNullableNumber(product?.weightKg)
  return {
    listing,
    listings: mapStoredListings(product, listing),
    accountStates: mapAccountGlances(product.accounts),
    soldAccountId:
      typeof product.soldAccountId === "string" ? product.soldAccountId : null,
    typeAttributes:
      product.typeAttributes && typeof product.typeAttributes === "object"
        ? product.typeAttributes
        : {},
    listingActive: computeListingActive(listing),
    shippingPublishReady: isShippingPublishReady({
      weightKg,
      shippingEnabled: listing?.shippingEnabled,
    }),
  }
}

export function toInventoryProduct({
  product,
  category,
  images,
  listing,
  conditionCode,
}: InventoryProductSource): InventoryProduct {
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
    brand: asString(product?.brand) || null,
    weight: asNullableNumber(product?.weightKg),
    shippingPackageSize: asPackageSize(product?.shippingPackageSize),
    widthCm: asNullableNumber(product?.widthCm),
    lengthCm: asNullableNumber(product?.lengthCm),
    heightCm: asNullableNumber(product?.heightCm),
    images,
    productImages: mappedProductImages(product),
    status: asStatus(product?.status),
    externalLinks: listing?.externalUrl ? [listing.externalUrl] : [],
    createdAt: asString(product?.createdAt),
    updatedAt: asString(product?.updatedAt),
    ...inventoryListingMeta(product, listing),
  }
}

export function mapProductToInventory(
  product: ApiProduct,
  category: ApiCategory | null,
  accountName: string,
): InventoryProduct {
  return toInventoryProduct({
    product,
    category,
    images: productImageUrls(product),
    listing: mapApiListing(product?.listing, accountName),
    conditionCode: asCondition(product?.condition),
  })
}
