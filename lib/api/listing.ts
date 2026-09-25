import "server-only"

import { apiServerFetch } from "@/lib/api/server"
import type { ApiListing } from "@/lib/api/types"
import {
  productListingApiPutBodySchema,
  type ProductListingApiPutBody,
} from "@/lib/validations/listing"

export async function apiGetProductListing(
  productId: string,
): Promise<ApiListing | null> {
  const body = await apiServerFetch<{ listing: ApiListing | null }>(
    `/products/${encodeURIComponent(productId)}/listing`,
  )
  return body.listing
}

export async function apiPutProductListing(
  productId: string,
  input: ProductListingApiPutBody,
): Promise<ApiListing> {
  const payload = productListingApiPutBodySchema.parse(input)
  const body = await apiServerFetch<{ listing: ApiListing | null }>(
    `/products/${encodeURIComponent(productId)}/listing`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
  )
  if (!body.listing) {
    throw new Error("Listing missing from API response.")
  }
  return body.listing
}
