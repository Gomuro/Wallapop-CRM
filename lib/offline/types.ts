import type { ProductCondition, ProductStatus } from "@/lib/validations"

export type OfflineProductDraft = {
  id?: string
  sku: string
  title: string
  description: string
  price: number
  categoryId: string
  condition: ProductCondition
  weight?: number | null
  status: ProductStatus
  images?: string[]
}
