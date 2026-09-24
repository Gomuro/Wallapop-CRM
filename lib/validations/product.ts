import { z } from "zod"

export const PRODUCT_IMAGE_MIN = 6
export const PRODUCT_IMAGE_MAX = 10

export const productStatusSchema = z.enum(
  ["ACTIVE", "SOLD", "INACTIVE"],
  { error: "Choose a status." },
)

export const productImageUrlSchema = z
  .string()
  .trim()
  .min(1, "Invalid image URL")
  .refine(
    (value) => value.startsWith("/uploads/") || URL.canParse(value),
    "Invalid image URL",
  )

export const productImagesSchema = z
  .array(productImageUrlSchema)
  .max(PRODUCT_IMAGE_MAX, `Add up to ${PRODUCT_IMAGE_MAX} photos.`)

export const productPublishImagesSchema = productImagesSchema.min(
  PRODUCT_IMAGE_MIN,
  `Add at least ${PRODUCT_IMAGE_MIN} photos.`,
)

export const productCreateSchema = z.object({
  sku: z.string().trim().min(1, "Enter a SKU.").max(64, "SKU is too long."),
  title: z
    .string()
    .trim()
    .min(1, "Enter a title.")
    .max(200, "Title is too long."),
  description: z
    .string()
    .trim()
    .max(10_000, "Description is too long.")
    .default(""),
  price: z
    .number({ error: "Enter a valid price." })
    .finite("Enter a valid price.")
    .nonnegative("Price cannot be negative."),
  category: z
    .string()
    .trim()
    .min(1, "Choose a category.")
    .max(100, "Category is too long."),
  condition: z
    .string()
    .trim()
    .min(1, "Choose a condition.")
    .max(100, "Condition is too long."),
  weight: z
    .number({ error: "Enter a valid weight." })
    .finite("Enter a valid weight.")
    .nonnegative("Weight cannot be negative.")
    .nullable()
    .optional(),
  images: productImagesSchema.default([]),
  status: productStatusSchema.default("ACTIVE"),
  externalLinks: z.array(z.string().trim().url()).default([]),
})

export const productUpdateSchema = productCreateSchema.partial()

export type ProductCreateInput = z.infer<typeof productCreateSchema>
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>
export type ProductStatus = z.infer<typeof productStatusSchema>
