import "server-only"

import { ApiError } from "@/lib/api/errors"
import { apiGetDefaultAccount } from "@/lib/api/accounts"
import { apiGetCategory, apiListCategories } from "@/lib/api/categories"
import { apiPutProductListing } from "@/lib/api/listing"
import {
  mapApiListing,
  mapListItemToInventory,
  mapProductToInventory,
} from "@/lib/api/map-product"
import {
  apiCreateProduct,
  apiDeleteProduct,
  apiGetProduct,
  apiListProducts,
  apiMarkProductSold,
  apiPatchProduct,
  apiPatchProductStatus,
} from "@/lib/api/products"
import type { ApiCategory } from "@/lib/api/types"
import type { ProductCreateInput, ProductUpdateInput } from "@/lib/validations"
import type {
  InventoryListing,
  InventoryProduct,
  MarkSoldResult,
  ProductListQuery,
  StatusCounts,
} from "@/lib/inventory/types"
import type { ProductListingApiPutBody } from "@/lib/validations/listing"
import type { ProductStatus } from "@/lib/validations"

export async function listCategoriesFlat(): Promise<ApiCategory[]> {
  return apiListCategories()
}

export async function listCategoryRoots(): Promise<ApiCategory[]> {
  return apiListCategories("root")
}

function warehouseCreateBody(input: ProductCreateInput) {
  return {
    sku: input.sku,
    title: input.title,
    description: input.description ?? "",
    price: input.price,
    currency: "EUR" as const,
    categoryId: input.categoryId,
    condition: input.condition,
    weightKg: input.weight ?? null,
    brand: null,
    typeAttributes: {},
  }
}

function warehousePatchBody(input: ProductUpdateInput) {
  const body: Record<string, unknown> = {}
  if (input.sku !== undefined) body.sku = input.sku
  if (input.title !== undefined) body.title = input.title
  if (input.description !== undefined) body.description = input.description
  if (input.price !== undefined) body.price = input.price
  if (input.categoryId !== undefined) body.categoryId = input.categoryId
  if (input.condition !== undefined) body.condition = input.condition
  if (input.weight !== undefined) body.weightKg = input.weight
  return body
}

export async function listProducts(
  query: ProductListQuery = {},
): Promise<InventoryProduct[]> {
  const response = await apiListProducts({
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 50,
    status: query.status ?? "ALL",
    q: query.q,
    categoryId: query.categoryId,
  })
  return response.products.map((row) => mapListItemToInventory(row))
}

export async function countProductsByStatus(
  q?: string,
): Promise<StatusCounts> {
  const trimmed = q?.trim()
  const statuses: Array<ProductStatus | "ALL"> = [
    "ALL",
    "ACTIVE",
    "SOLD",
    "INACTIVE",
  ]
  const totals = await Promise.all(
    statuses.map(async (status) => {
      const { total } = await apiListProducts({
        page: 1,
        pageSize: 1,
        status,
        q: trimmed || undefined,
      })
      return total
    }),
  )
  return {
    ALL: totals[0] ?? 0,
    ACTIVE: totals[1] ?? 0,
    SOLD: totals[2] ?? 0,
    INACTIVE: totals[3] ?? 0,
  }
}

export async function getProduct(id: string): Promise<InventoryProduct | null> {
  try {
    const [product, account] = await Promise.all([
      apiGetProduct(id),
      apiGetDefaultAccount(),
    ])
    let category: ApiCategory | null = null
    try {
      category = await apiGetCategory(product.categoryId)
    } catch {
      category = null
    }
    return mapProductToInventory(
      product,
      category,
      account?.name ?? "Account",
    )
  } catch (error) {
    if (error instanceof ApiError && error.code === "NOT_FOUND") return null
    throw error
  }
}

export async function createProduct(
  input: ProductCreateInput,
): Promise<InventoryProduct> {
  const account = await apiGetDefaultAccount()
  const created = await apiCreateProduct(warehouseCreateBody(input))
  let category: ApiCategory | null = null
  try {
    category = await apiGetCategory(created.categoryId)
  } catch {
    category = null
  }
  return mapProductToInventory(
    created,
    category,
    account?.name ?? "Account",
  )
}

export async function updateProduct(
  id: string,
  input: ProductUpdateInput & { categoryId?: string },
  options?: { status?: ProductStatus; previousStatus?: ProductStatus },
): Promise<InventoryProduct | null> {
  const account = await apiGetDefaultAccount()
  const patch = warehousePatchBody(input)
  let product =
    Object.keys(patch).length > 0
      ? await apiPatchProduct(id, patch)
      : await apiGetProduct(id)

  const nextStatus = options?.status ?? input.status
  const prevStatus = options?.previousStatus
  if (
    nextStatus &&
    prevStatus &&
    nextStatus !== prevStatus &&
    nextStatus !== "SOLD" &&
    prevStatus !== "SOLD"
  ) {
    if (nextStatus === "ACTIVE" || nextStatus === "INACTIVE") {
      product = await apiPatchProductStatus(id, nextStatus)
    }
  }

  let category: ApiCategory | null = null
  try {
    category = await apiGetCategory(product.categoryId)
  } catch {
    category = null
  }
  return mapProductToInventory(
    product,
    category,
    account?.name ?? "Account",
  )
}

export async function deleteProduct(id: string): Promise<boolean> {
  try {
    await apiDeleteProduct(id)
    return true
  } catch (error) {
    if (error instanceof ApiError && error.code === "NOT_FOUND") return false
    throw error
  }
}

export async function updateProductListing(
  productId: string,
  body: ProductListingApiPutBody,
): Promise<InventoryListing> {
  const account = await apiGetDefaultAccount()
  const accountName = account?.name ?? "Account"
  const listing = await apiPutProductListing(productId, body)
  const mapped = mapApiListing(listing, accountName)
  if (!mapped) {
    throw new Error("Listing missing after update.")
  }
  return mapped
}

export async function markProductSold(id: string): Promise<MarkSoldResult> {
  try {
    const account = await apiGetDefaultAccount()
    const product = await apiMarkProductSold(id)
    let category: ApiCategory | null = null
    try {
      category = await apiGetCategory(product.categoryId)
    } catch {
      category = null
    }
    return {
      ok: true,
      product: mapProductToInventory(
        product,
        category,
        account?.name ?? "Account",
      ),
    }
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.code === "NOT_FOUND") return { ok: false, reason: "not-found" }
      if (error.code === "ALREADY_SOLD") {
        return { ok: false, reason: "already-sold" }
      }
    }
    throw error
  }
}
