import { z } from "zod"

export const PRODUCT_IMAGE_SORT_MAX = 9

export const productImageCreateSchema = z.object({
  productId: z.string().trim().min(1),
  storageKey: z.string().trim().min(1).max(500),
  url: z.string().trim().min(1).max(2000),
  sortOrder: z
    .number({ error: "Enter a sort order." })
    .int()
    .min(0, "Cover is sort order 0.")
    .max(PRODUCT_IMAGE_SORT_MAX, "At most 10 photos (sort order 0–9)."),
})

export const productImageUpdateSchema = productImageCreateSchema
  .omit({ productId: true })
  .partial()

export type ProductImageCreateInput = z.infer<typeof productImageCreateSchema>
export type ProductImageUpdateInput = z.infer<typeof productImageUpdateSchema>
