import { z } from "zod"

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
  category: z
    .string()
    .trim()
    .min(1, "Elige una categoría.")
    .max(100, "La categoría es demasiado larga."),
  condition: z
    .string()
    .trim()
    .min(1, "Elige un estado.")
    .max(100, "El estado es demasiado largo."),
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

export type ProductCreateInput = z.infer<typeof productCreateSchema>
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>
export type ProductStatus = z.infer<typeof productStatusSchema>
