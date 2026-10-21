import type { ListingStatus, ProductCondition, ProductStatus, ShippingPackageSize } from "@/lib/validations"

/** Listing status as returned by GET (in-flight POSTING, watchdog FAILED). Not writable via PUT. */
export type ListingStatusRead = ListingStatus | "POSTING" | "FAILED"

export type InventoryProductImage = {
  id: string
  url: string
  sortOrder: number
}

/** Single default-account listing (matches API listing JSON). */
export type AccountListingGlance = {
  accountId: string
  accountName: string
  isDefault: boolean
  status: ListingStatusRead | null
  externalUrl: string | null
  lastPublishError?: string | null
}

export type InventoryListing = {
  id: string
  accountId: string
  accountName?: string
  isDefault?: boolean
  externalUrl: string | null
  status: ListingStatusRead
  lastPostedAt: string | null
  updatedAt?: string | null
  shippingEnabled: boolean
}

export type InventoryProductIdentity = {
  id: string
  sku: string
  categoryId: string
  category: string
  status: ProductStatus
  createdAt: string
  updatedAt: string
}

export type InventoryProductCopy = {
  title: string
  description: string
  price: number
  condition: string
  conditionCode: ProductCondition
  brand: string | null
}

export type InventoryProductWarehouse = {
  weight: number | null
  shippingPackageSize: ShippingPackageSize | null
  widthCm: number | null
  lengthCm: number | null
  heightCm: number | null
}

export type InventoryProductMedia = {
  images: string[]
  productImages: InventoryProductImage[]
  externalLinks: string[]
  listing: InventoryListing | null
  /** Every ProductListing row already stored. Absent on catalog cards. */
  listings?: InventoryListing[]
  /** One row per Wallapop account, including accounts with no listing yet. */
  accountStates?: AccountListingGlance[]
  soldAccountId?: string | null
  typeAttributes: Record<string, unknown>
  /** From GET /products list when full listing is omitted. */
  listingActive?: boolean
  shippingPublishReady: boolean
}

export type InventoryProduct = InventoryProductIdentity &
  InventoryProductCopy &
  InventoryProductWarehouse &
  InventoryProductMedia

export type CatalogListingFilter =
  | "wallapop"
  | "reserved"
  | "queue"
  | "error"
  | "nolink"

export type ProductListQuery = {
  q?: string
  status?: ProductStatus | "ALL"
  page?: number
  pageSize?: number
  categoryId?: string
  listing?: CatalogListingFilter
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
