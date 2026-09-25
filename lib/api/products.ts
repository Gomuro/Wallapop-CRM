import "server-only"

import { apiServerFetch } from "@/lib/api/server"
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
  return apiServerFetch<ApiProductListResponse>(`/products${qs}`)
}

export async function apiGetProduct(id: string): Promise<ApiProduct> {
  const { product } = await apiServerFetch<{ product: ApiProduct }>(
    `/products/${id}`,
  )
  return product
}

type ApiProductCreateBody = Omit<
  WarehouseProductCreateInput,
  "soldAt" | "soldPrice" | "status"
> & { status?: WarehouseProductCreateInput["status"] }

export async function apiCreateProduct(
  body: ApiProductCreateBody,
): Promise<ApiProduct> {
  const { product } = await apiServerFetch<{ product: ApiProduct }>(
    "/products",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  )
  return product
}

export async function apiPatchProduct(
  id: string,
  body: WarehouseProductUpdateInput,
): Promise<ApiProduct> {
  const { product } = await apiServerFetch<{ product: ApiProduct }>(
    `/products/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify(body),
    },
  )
  return product
}

export async function apiPatchProductStatus(
  id: string,
  status: Exclude<ProductStatus, "SOLD">,
): Promise<ApiProduct> {
  const { product } = await apiServerFetch<{ product: ApiProduct }>(
    `/products/${id}/status`,
    {
      method: "PATCH",
      body: JSON.stringify({ status }),
    },
  )
  return product
}

export async function apiMarkProductSold(id: string): Promise<ApiProduct> {
  const { product } = await apiServerFetch<{ product: ApiProduct }>(
    `/products/${id}/sold`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  )
  return product
}

export async function apiDeleteProduct(id: string): Promise<void> {
  await apiServerFetch<void>(`/products/${id}`, { method: "DELETE" })
}
