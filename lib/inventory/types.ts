import type { ListingStatus, ProductCondition, ProductStatus, ShippingPackageSize } from "@/lib/validations"

/** Listing status as returned by GET (in-flight POSTING, watchdog FAILED, duplicate PREPARING). Not writable via PUT. */
export type ListingStatusRead = ListingStatus | "POSTING" | "FAILED" | "PREPARING"

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

/** Own wording and price (account's ending, e.g. ,98) of a duplicate on a non-default account. */
export type DuplicateVariant = {
  title: string | null
  description: string | null
  price: number | null
  source: "ai" | "manual" | null
  generatedAt: string | null
  error: string | null
  /** The product text changed after this variant was written. */
  stale: boolean
  /** Background runs that failed so far, and when the next one is due. */
  attempts: number
  nextAttemptAt: string | null
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
  lastPublishError?: string | null
} & ListingVariantPart

export type ListingVariantPart = {
  variant?: DuplicateVariant | null
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
