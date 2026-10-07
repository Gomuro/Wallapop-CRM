import type { ListingStatus, ProductCondition, ProductStatus, ShippingPackageSize } from "@/lib/validations"

/** Listing status as returned by GET (in-flight POSTING, watchdog FAILED). Not writable via PUT. */
export type ListingStatusRead = ListingStatus | "POSTING" | "FAILED"

export type InventoryProductImage = {
  id: string
  url: string
  sortOrder: number
}

/** Single default-account listing (matches API listing JSON). */
export type InventoryListing = {
  id: string
  accountId: string
  accountName?: string
  externalUrl: string | null
  status: ListingStatusRead
  lastPostedAt: string | null
  shippingEnabled: boolean
}

export type InventoryProduct = {
  id: string
  sku: string
  title: string
  description: string
  price: number
  categoryId: string
  category: string
  condition: string
  conditionCode: ProductCondition
  brand: string | null
  weight: number | null
  shippingPackageSize: ShippingPackageSize | null
  widthCm: number | null
  lengthCm: number | null
  heightCm: number | null
  images: string[]
  productImages: InventoryProductImage[]
  status: ProductStatus
  externalLinks: string[]
  createdAt: string
  updatedAt: string
  listing: InventoryListing | null
  /** From GET /products list when full listing is omitted. */
  listingActive?: boolean
  shippingPublishReady: boolean
}

export type ProductListQuery = {
  q?: string
  status?: ProductStatus | "ALL"
  page?: number
  pageSize?: number
  categoryId?: string
}

/** First screen + each infinite-scroll chunk on the catalog. */
export const CATALOG_PAGE_SIZE = 50

export type ProductListPage = {
  products: InventoryProduct[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export type StatusCounts = {
  ALL: number
  ACTIVE: number
  SOLD: number
  INACTIVE: number
}

export type MarkSoldResult =
  | { ok: true; product: InventoryProduct }
  | { ok: false; reason: "not-found" | "already-sold" }

export const PRODUCT_CATEGORIES = [
  "Electronics",
  "Home",
  "Fashion",
  "Sports",
  "Toys",
  "Other",
] as const

export const PRODUCT_CONDITIONS = [
  "New",
  "As good as new",
  "Good",
  "Fair",
  "Has given it all",
] as const
