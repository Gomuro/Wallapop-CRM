import { z } from "zod"

export const PRODUCT_IMAGE_SORT_MAX = 9

export const productImageCreateSchema = z.object({
  productId: z.string().trim().min(1),
  storageKey: z.string().trim().min(1).max(500),
  url: z.string().trim().min(1).max(2000),
  sortOrder: z
    .number({ error: "Indica el orden." })
    .int()
    .min(0, "La portada es el orden 0.")
    .max(PRODUCT_IMAGE_SORT_MAX, "Como máximo 10 fotos (orden 0–9)."),
})

export const productImageUpdateSchema = productImageCreateSchema
  .omit({ productId: true })
  .partial()

export const productImagesReorderSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(10),
})

export type ProductImageCreateInput = z.infer<typeof productImageCreateSchema>
export type ProductImageUpdateInput = z.infer<typeof productImageUpdateSchema>
export type ProductImagesReorderInput = z.infer<typeof productImagesReorderSchema>
