import { z } from "zod"

import {
  assertProductCategoryIsLeaf,
  productCategoryLeafSchema,
} from "./category"

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

export const productConditionSchema = z.enum([
  "NEW",
  "AS_GOOD_AS_NEW",
  "GOOD",
  "FAIR",
  "HAS_GIVEN_IT_ALL",
])

const moneySchema = z
  .number({ error: "Enter a valid price." })
  .finite("Enter a valid price.")
  .nonnegative("Price cannot be negative.")
  .max(99_999_999.99, "Price is too large.")

export const warehouseProductCreateSchema = z.object({
  sku: z.string().trim().min(1, "Enter a SKU.").max(64, "SKU is too long."),
  title: z
    .string()
    .trim()
    .min(1, "Enter a title.")
    .max(200, "Title is too long."),
  description: z
    .string()
    .max(10_000, "Description is too long.")
    .default(""),
  price: moneySchema,
  currency: z.literal("EUR").default("EUR"),
  categoryId: z.string().trim().min(1, "Choose a category."),
  condition: productConditionSchema,
  brand: z.string().trim().max(100).nullable().optional(),
  weightKg: z
    .number({ error: "Enter a valid weight." })
    .finite("Enter a valid weight.")
    .nonnegative("Weight cannot be negative.")
    .nullable()
    .optional(),
  status: productStatusSchema.default("ACTIVE"),
  typeAttributes: z.record(z.string(), z.unknown()).default({}),
  soldAt: z.coerce.date().nullable().optional(),
  soldPrice: moneySchema.nullable().optional(),
})

export const warehouseProductUpdateSchema = warehouseProductCreateSchema.partial()

export const warehouseProductStatusPatchSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE"], { error: "Choose a status." }),
})

export const productSoldBodySchema = z
  .object({
    soldPrice: moneySchema.optional(),
  })
  .default({})

export const productListStatusFilterSchema = z.enum([
  "ALL",
  "ACTIVE",
  "SOLD",
  "INACTIVE",
])

export const productListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: productListStatusFilterSchema.default("ALL"),
  q: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  categoryId: z.string().trim().min(1).optional(),
})

export const warehouseProductCreateWithLeafSchema =
  warehouseProductCreateSchema
    .extend({ category: productCategoryLeafSchema })
    .refine((value) => value.categoryId === value.category.id, {
      message: "categoryId must match the leaf category id.",
      path: ["categoryId"],
    })

export function parseWarehouseProductCreate(
  data: unknown,
  category: { id: string; isLeaf: boolean },
) {
  const product = warehouseProductCreateSchema.parse(data)
  assertProductCategoryIsLeaf(category)
  if (product.categoryId !== category.id) {
    throw new Error("categoryId must match the leaf category id.")
  }
  return product
}

export type ProductCreateInput = z.infer<typeof productCreateSchema>
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>
export type ProductStatus = z.infer<typeof productStatusSchema>
export type ProductCondition = z.infer<typeof productConditionSchema>
export type WarehouseProductCreateInput = z.infer<
  typeof warehouseProductCreateSchema
>
export type WarehouseProductUpdateInput = z.infer<
  typeof warehouseProductUpdateSchema
>
export type ProductListStatusFilter = z.infer<
  typeof productListStatusFilterSchema
>
export type ProductListQuery = z.infer<typeof productListQuerySchema>
