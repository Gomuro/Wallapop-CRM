import { z } from "zod"

export const PRODUCT_IMAGE_MIN = 6
export const PRODUCT_IMAGE_MAX = 10

export const productStatusSchema = z.enum(["ACTIVE", "SOLD", "INACTIVE"])

export const productImageUrlSchema = z.string().trim().url()

export const productImagesSchema = z
  .array(productImageUrlSchema)
  .max(PRODUCT_IMAGE_MAX)

export const productPublishImagesSchema = productImagesSchema.min(
  PRODUCT_IMAGE_MIN,
)

export const productCreateSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(10_000).default(""),
  price: z.number().finite().nonnegative(),
  category: z.string().trim().min(1).max(100),
  condition: z.string().trim().min(1).max(100),
  weight: z.number().finite().nonnegative().nullable().optional(),
  images: productImagesSchema.default([]),
  status: productStatusSchema.default("ACTIVE"),
  externalLinks: z.array(z.string().trim().url()).default([]),
})

export const productUpdateSchema = productCreateSchema.partial()

export type ProductCreateInput = z.infer<typeof productCreateSchema>
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>
export type ProductStatus = z.infer<typeof productStatusSchema>
