import { z } from "zod"

export const categoryCreateSchema = z.object({
  wallapopId: z.number({ error: "Enter a Wallapop id." }).int().positive(),
  parentId: z.string().trim().min(1).nullable().optional(),
  slug: z.string().trim().min(1).max(200),
  nameEs: z.string().trim().min(1).max(200),
  nameUk: z.string().trim().min(1).max(200),
  isLeaf: z.boolean(),
  leafSelectionMandatory: z.boolean(),
  verticalId: z.string().trim().min(1).nullable().optional(),
  listingType: z.string().trim().min(1).nullable().optional(),
  path: z
    .string()
    .regex(/^\d+(\/\d+)*\/$/, "path must be wallapop_id segments with a trailing slash."),
  depth: z.number().int().min(1).max(16),
  attributes: z.record(z.string(), z.unknown()).default({}),
  seoLegacyId: z.number().int().positive().nullable().optional(),
  sortOrder: z.number().int().nonnegative(),
})

export const categoryUpdateSchema = categoryCreateSchema.partial()

/** products.category_id must point at a leaf (enforced in Zod, not Postgres). */
export const productCategoryLeafSchema = z.object({
  id: z.string().trim().min(1),
  isLeaf: z.literal(true, {
    error: "products.category_id must point at a leaf category.",
  }),
})

export function assertProductCategoryIsLeaf(category: {
  id: string
  isLeaf: boolean
}) {
  return productCategoryLeafSchema.parse(category)
}

export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>
export type ProductCategoryLeaf = z.infer<typeof productCategoryLeafSchema>
