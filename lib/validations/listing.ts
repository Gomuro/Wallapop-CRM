import { z } from "zod"

import { wallapopItemUrlOrNull } from "../inventory/wallapop-item-url"

/** Public PUT / create status. `POSTING` is internal (publish claim) and is rejected here. */
export const listingStatusSchema = z.enum([
  "READY_TO_POST",
  "ACTIVE",
  "DEACTIVATED",
])

/** Read/API mapping: includes internal `POSTING` while a live publish is in flight. */
export const listingStatusReadSchema = z.enum([
  "READY_TO_POST",
  "POSTING",
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
    externalUrl: z
      .union([z.string(), z.null()])
      .optional()
      .transform((value) => wallapopItemUrlOrNull(value)),
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
export type ListingStatusRead = z.infer<typeof listingStatusReadSchema>
