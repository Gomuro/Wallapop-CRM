import { z } from "zod"

export const listingStatusSchema = z.enum([
  "ACTIVE",
  "DEACTIVATED",
  "READY_TO_POST",
])

export const productListingCreateSchema = z.object({
  productId: z.string().trim().min(1),
  accountId: z.string().trim().min(1),
  externalUrl: z.string().trim().url().nullable().optional(),
  externalLinks: z.array(z.string().trim().url()).default([]),
  status: listingStatusSchema.default("ACTIVE"),
})

export const productListingUpdateSchema = productListingCreateSchema
  .omit({ productId: true, accountId: true })
  .partial()

export type ProductListingCreateInput = z.infer<
  typeof productListingCreateSchema
>
export type ProductListingUpdateInput = z.infer<
  typeof productListingUpdateSchema
>
export type ListingStatus = z.infer<typeof listingStatusSchema>
