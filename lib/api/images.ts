import "server-only"

import { ApiError } from "@/lib/api/errors"
import { apiServerFetch } from "@/lib/api/server"
import type { ApiProduct } from "@/lib/api/types"

function unwrapApiProduct(body: { product?: ApiProduct } | undefined): ApiProduct {
  if (!body?.product || typeof body.product !== "object" || !body.product.id) {
    throw new ApiError(
      502,
      "INTERNAL",
      "El servidor devolvió un producto no válido.",
    )
  }
  if (!Array.isArray(body.product.images)) {
    body.product.images = []
  }
  return body.product
}

export async function apiUploadProductImages(
  productId: string,
  formData: FormData,
): Promise<ApiProduct> {
  return unwrapApiProduct(
    await apiServerFetch<{ product?: ApiProduct }>(
      `/products/${productId}/images`,
      {
        method: "POST",
        body: formData,
      },
    ),
  )
}

export async function apiReorderProductImages(
  productId: string,
  ids: string[],
): Promise<ApiProduct> {
  return unwrapApiProduct(
    await apiServerFetch<{ product?: ApiProduct }>(
      `/products/${productId}/images`,
      {
        method: "PATCH",
        body: JSON.stringify({ ids }),
      },
    ),
  )
}

export async function apiDeleteProductImage(
  productId: string,
  imageId: string,
): Promise<ApiProduct> {
  return unwrapApiProduct(
    await apiServerFetch<{ product?: ApiProduct }>(
      `/products/${productId}/images/${imageId}`,
      { method: "DELETE" },
    ),
  )
}
