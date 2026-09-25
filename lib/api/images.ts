import "server-only"

import { apiServerFetch } from "@/lib/api/server"
import type { ApiProduct } from "@/lib/api/types"

export async function apiUploadProductImages(
  productId: string,
  formData: FormData,
): Promise<ApiProduct> {
  const { product } = await apiServerFetch<{ product: ApiProduct }>(
    `/products/${productId}/images`,
    {
      method: "POST",
      body: formData,
    },
  )
  return product
}

export async function apiReorderProductImages(
  productId: string,
  ids: string[],
): Promise<ApiProduct> {
  const { product } = await apiServerFetch<{ product: ApiProduct }>(
    `/products/${productId}/images`,
    {
      method: "PATCH",
      body: JSON.stringify({ ids }),
    },
  )
  return product
}

export async function apiDeleteProductImage(
  productId: string,
  imageId: string,
): Promise<ApiProduct> {
  const { product } = await apiServerFetch<{ product: ApiProduct }>(
    `/products/${productId}/images/${imageId}`,
    { method: "DELETE" },
  )
  return product
}
