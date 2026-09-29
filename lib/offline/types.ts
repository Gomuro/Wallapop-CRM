import type { ProductCondition, ProductStatus, ShippingPackageSize } from "@/lib/validations"

export type OfflineProductDraft = {
  id?: string
  sku: string
  title: string
  description: string
  price: number
  categoryId: string
  condition: ProductCondition
  weight?: number | null
  shippingPackageSize?: ShippingPackageSize | null
  widthCm?: number | null
  lengthCm?: number | null
  heightCm?: number | null
  status: ProductStatus
  images?: string[]
}
