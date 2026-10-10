import type { ProductCondition, ProductStatus, ShippingPackageSize } from "@/lib/validations"

export type OfflineProductDraftIdentity = {
  id?: string
  sku: string
  categoryId: string
  status: ProductStatus
}

export type OfflineProductDraftCopy = {
  title: string
  description: string
  price: number
  condition: ProductCondition
}

export type OfflineProductDraftWarehouse = {
  weight?: number | null
  shippingPackageSize?: ShippingPackageSize | null
  widthCm?: number | null
  lengthCm?: number | null
  heightCm?: number | null
  images?: string[]
}

export type OfflineProductDraft = OfflineProductDraftIdentity &
  OfflineProductDraftCopy &
  OfflineProductDraftWarehouse
