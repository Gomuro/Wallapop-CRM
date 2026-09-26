import "server-only"

import { apiServerFetch } from "@/lib/api/server"
import { ApiError } from "@/lib/api/errors"
import type {
  ApiProduct,
  ApiProductListResponse,
} from "@/lib/api/types"
import type { ProductListQuery } from "@/lib/inventory/types"
import type {
  WarehouseProductCreateInput,
  WarehouseProductUpdateInput,
} from "@/lib/validations/product"
import type { ProductStatus } from "@/lib/validations"

function toQueryString(query: Record<string, string | number | undefined>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === "") continue
    params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ""
}

export async function apiListProducts(
  query: ProductListQuery = {},
): Promise<ApiProductListResponse> {
  const qs = toQueryString({
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 50,
    status: query.status ?? "ALL",
    q: query.q,
    categoryId: query.categoryId,
  })
  const response = await apiServerFetch<Partial<ApiProductListResponse>>(
    `/products${qs}`,
  )
  return {
    products: Array.isArray(response?.products) ? response.products : [],
    page: typeof response?.page === "number" ? response.page : 1,
    pageSize: typeof response?.pageSize === "number" ? response.pageSize : 50,
    total: typeof response?.total === "number" ? response.total : 0,
    totalPages: typeof response?.totalPages === "number" ? response.totalPages : 0,
  }
}

function unwrapApiProduct(body: { product?: ApiProduct } | undefined): ApiProduct {
  if (!body?.product || typeof body.product !== "object" || !body.product.id) {
    throw new ApiError(
      502,
      "INTERNAL",
      "El servidor devolvió un producto no válido.",
    )
  }
  return body.product
}

export async function apiGetProduct(id: string): Promise<ApiProduct> {
  const body = await apiServerFetch<{ product?: ApiProduct }>(
    `/products/${id}`,
  )
  return unwrapApiProduct(body)
}

type ApiProductCreateBody = Omit<
  WarehouseProductCreateInput,
  "soldAt" | "soldPrice" | "status"
> & { status?: WarehouseProductCreateInput["status"] }

export async function apiCreateProduct(
  body: ApiProductCreateBody,
): Promise<ApiProduct> {
  const product = unwrapApiProduct(
    await apiServerFetch<{ product?: ApiProduct }>("/products", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  )
  return product
}

export async function apiPatchProduct(
  id: string,
  body: WarehouseProductUpdateInput,
): Promise<ApiProduct> {
  return unwrapApiProduct(
    await apiServerFetch<{ product?: ApiProduct }>(`/products/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  )
}

export async function apiPatchProductStatus(
  id: string,
  status: Exclude<ProductStatus, "SOLD">,
): Promise<ApiProduct> {
  return unwrapApiProduct(
    await apiServerFetch<{ product?: ApiProduct }>(`/products/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  )
}

export async function apiMarkProductSold(id: string): Promise<ApiProduct> {
  return unwrapApiProduct(
    await apiServerFetch<{ product?: ApiProduct }>(`/products/${id}/sold`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  )
}

export async function apiDeleteProduct(id: string): Promise<void> {
  await apiServerFetch<void>(`/products/${id}`, { method: "DELETE" })
}
