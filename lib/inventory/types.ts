import type { ListingStatus, ProductStatus } from "@/lib/validations"

export type InventoryListing = {
  id: string
  accountId: string
  accountName: string
  externalUrl: string | null
  status: ListingStatus
}

export type InventoryProduct = {
  id: string
  sku: string
  title: string
  description: string
  price: number
  category: string
  condition: string
  weight: number | null
  images: string[]
  status: ProductStatus
  externalLinks: string[]
  createdAt: string
  updatedAt: string
  listings: InventoryListing[]
}

export type ProductListQuery = {
  q?: string
  status?: ProductStatus | "ALL"
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
