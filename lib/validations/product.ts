import { z } from "zod"

import {
  assertProductCategoryIsLeaf,
  productCategoryLeafSchema,
} from "./category"

export const PRODUCT_IMAGE_MIN = 6
export const PRODUCT_IMAGE_MAX = 10

export const productStatusSchema = z.enum(
  ["ACTIVE", "SOLD", "INACTIVE"],
  { error: "Elige un estado de venta." },
)

export const productImageUrlSchema = z
  .string()
  .trim()
  .min(1, "URL de imagen no válida")
  .refine(
    (value) =>
      value.startsWith("/uploads/") ||
      value.startsWith("data:image/") ||
      URL.canParse(value),
    "URL de imagen no válida",
  )

export const productImagesSchema = z
  .array(productImageUrlSchema)
  .max(PRODUCT_IMAGE_MAX, `Añade como máximo ${PRODUCT_IMAGE_MAX} fotos.`)

export const productPublishImagesSchema = productImagesSchema.min(
  PRODUCT_IMAGE_MIN,
  `Añade al menos ${PRODUCT_IMAGE_MIN} fotos.`,
)

export const productConditionSchema = z.enum([
  "NEW",
  "AS_GOOD_AS_NEW",
  "GOOD",
  "FAIR",
  "HAS_GIVEN_IT_ALL",
])

export const productCreateSchema = z.object({
  sku: z.string().trim().min(1, "Introduce un SKU.").max(64, "El SKU es demasiado largo."),
  title: z
    .string()
    .trim()
    .min(1, "Introduce un título.")
    .max(200, "El título es demasiado largo."),
  description: z
    .string()
    .trim()
    .max(10_000, "La descripción es demasiado larga.")
    .default(""),
  price: z
    .number({ error: "Introduce un precio válido." })
    .finite("Introduce un precio válido.")
    .nonnegative("El precio no puede ser negativo."),
  categoryId: z.string().trim().min(1, "Elige una categoría."),
  condition: productConditionSchema,
  weight: z
    .number({ error: "Introduce un peso válido." })
    .finite("Introduce un peso válido.")
    .nonnegative("El peso no puede ser negativo.")
    .nullable()
    .optional(),
  images: productImagesSchema.default([]),
  status: productStatusSchema.default("ACTIVE"),
  externalLinks: z.array(z.string().trim().url()).default([]),
})

export const productUpdateSchema = productCreateSchema.partial()

const moneySchema = z
  .number({ error: "Introduce un precio válido." })
  .finite("Introduce un precio válido.")
  .nonnegative("El precio no puede ser negativo.")
  .max(99_999_999.99, "El precio es demasiado alto.")

export const warehouseProductCreateSchema = z.object({
  sku: z.string().trim().min(1, "Introduce un SKU.").max(64, "El SKU es demasiado largo."),
  title: z
    .string()
    .trim()
    .min(1, "Introduce un título.")
    .max(200, "El título es demasiado largo."),
  description: z
    .string()
    .max(10_000, "La descripción es demasiado larga.")
    .default(""),
  price: moneySchema,
  currency: z.literal("EUR").default("EUR"),
  categoryId: z.string().trim().min(1, "Elige una categoría."),
  condition: productConditionSchema,
  brand: z.string().trim().max(100).nullable().optional(),
  weightKg: z
    .number({ error: "Introduce un peso válido." })
    .finite("Introduce un peso válido.")
    .nonnegative("El peso no puede ser negativo.")
    .nullable()
    .optional(),
  status: productStatusSchema.default("ACTIVE"),
  typeAttributes: z.record(z.string(), z.unknown()).default({}),
  soldAt: z.coerce.date().nullable().optional(),
  soldPrice: moneySchema.nullable().optional(),
})

export const warehouseProductUpdateSchema = warehouseProductCreateSchema.partial()

export const warehouseProductStatusPatchSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE"], { error: "Elige un estado de venta." }),
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
