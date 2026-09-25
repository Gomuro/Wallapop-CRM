import type { ListingStatus, ProductCondition, ProductStatus } from "@/lib/validations"

export type ApiCategory = {
  id: string
  wallapopId: number
  parentId: string | null
  slug: string
  nameEs: string
  nameUk: string
  isLeaf: boolean
  leafSelectionMandatory: boolean
  depth: number
  path: string
  sortOrder: number
}

export type ApiProductImage = {
  id: string
  url: string
  storageKey?: string
  sortOrder: number
}

export type ApiListing = {
  id: string
  status: ListingStatus
  externalUrl: string | null
  externalItemId: string | null
  shippingEnabled: boolean
  shippingUpToKg: number | null
  accountId: string
}

export type ApiProduct = {
  id: string
  sku: string
  title: string
  description: string
  price: number
  currency: string
  categoryId: string
  condition: ProductCondition
  brand: string | null
  weightKg: number | null
  status: ProductStatus
  typeAttributes: Record<string, unknown>
  soldAt: string | null
  soldPrice: number | null
  images: ApiProductImage[]
  listing: ApiListing | null
  createdAt: string
  updatedAt: string
}

export type ApiProductListItem = {
  id: string
  sku: string
  title: string
  price: number
  currency: string
  status: ProductStatus
  categoryId: string
  coverUrl: string | null
  updatedAt: string
  listingActive: boolean
}

export type ApiProductListResponse = {
  products: ApiProductListItem[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export type ApiDefaultAccount = {
  id: string
  name: string
  status: string
  isDefault: boolean
  city: string | null
  postalCode: string | null
  createdAt: string
  updatedAt: string
}
