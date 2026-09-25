import { z } from "zod"

export const listingStatusSchema = z.enum([
  "READY_TO_POST",
  "ACTIVE",
  "DEACTIVATED",
])

export const productListingCreateSchema = z.object({
  productId: z.string().trim().min(1),
  accountId: z.string().trim().min(1),
  externalUrl: z.string().trim().url().nullable().optional(),
  externalItemId: z.string().trim().min(1).nullable().optional(),
  shippingEnabled: z.boolean().default(false),
  shippingUpToKg: z.number().int().positive().nullable().optional(),
  status: listingStatusSchema.default("READY_TO_POST"),
})

export const productListingUpdateSchema = productListingCreateSchema
  .omit({ productId: true, accountId: true })
  .partial()

export const productListingApiPutBodySchema = z
  .object({
    externalUrl: z.string().trim().url().nullable().optional(),
    status: listingStatusSchema.optional(),
    shippingEnabled: z.boolean().optional(),
    shippingUpToKg: z.number().int().positive().nullable().optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, {
    message: "Indica al menos un campo.",
  })

export type ProductListingApiPutBody = z.infer<
  typeof productListingApiPutBodySchema
>

export type ProductListingCreateInput = z.infer<
  typeof productListingCreateSchema
>
export type ProductListingUpdateInput = z.infer<
  typeof productListingUpdateSchema
>
export type ListingStatus = z.infer<typeof listingStatusSchema>
