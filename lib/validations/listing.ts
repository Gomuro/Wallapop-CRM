import { z } from "zod"

import { wallapopItemUrlOrNull } from "../inventory/wallapop-item-url"

/** Public PUT / create status. `POSTING` is internal (publish claim) and is rejected here. */
export const listingStatusSchema = z.enum([
  "READY_TO_POST",
  "ACTIVE",
  "RESERVED",
  "MISSING",
  "DEACTIVATED",
])

/** Read/API mapping: includes internal `POSTING`, watchdog `FAILED` and a duplicate waiting for its text (`PREPARING`). */
export const listingStatusReadSchema = z.enum([
  "READY_TO_POST",
  "PREPARING",
  "POSTING",
  "ACTIVE",
  "RESERVED",
  "MISSING",
  "DEACTIVATED",
  "FAILED",
])

export const productListingCreateSchema = z.object({
  productId: z.string().trim().min(1),
  accountId: z.string().trim().min(1),
  externalUrl: z.string().trim().url().nullable().optional(),
  externalItemId: z.string().trim().min(1).nullable().optional(),
  shippingEnabled: z.boolean().default(true),
  shippingUpToKg: z.number().int().positive().nullable().optional(),
  status: listingStatusSchema.default("READY_TO_POST"),
})

export const productListingUpdateSchema = productListingCreateSchema
  .omit({ productId: true, accountId: true })
  .partial()

export const productListingApiPutBodySchema = z
  .object({
    accountId: z.string().trim().min(1).optional(),
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
