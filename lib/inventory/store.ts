import "server-only"

import {
  memoryCountProductsByStatus,
  memoryCreateProduct,
  memoryDeleteProduct,
  memoryGetProduct,
  memoryListProducts,
  memoryMarkProductSold,
  memoryUpdateProduct,
} from "@/lib/inventory/memory"
import type { ProductCreateInput, ProductUpdateInput } from "@/lib/validations"
import type {
  InventoryProduct,
  MarkSoldResult,
  ProductListQuery,
  StatusCounts,
} from "@/lib/inventory/types"

/**
 * Issue #66 replaced stub Product columns (string category/images[]).
 * Warehouse Prisma CRUD is later; keep the UI on the in-memory catalog.
 */
export async function listProducts(
  query: ProductListQuery = {},
): Promise<InventoryProduct[]> {
  const status = query.status ?? "ALL"
  const q = query.q?.trim() ?? ""
  return memoryListProducts({ q, status })
}

export async function countProductsByStatus(
  q?: string,
): Promise<StatusCounts> {
  const query = q?.trim() ?? ""
  return memoryCountProductsByStatus(query)
}

export async function getProduct(id: string): Promise<InventoryProduct | null> {
  return memoryGetProduct(id)
}

export async function createProduct(
  input: ProductCreateInput,
): Promise<InventoryProduct> {
  return memoryCreateProduct(input)
}

export async function updateProduct(
  id: string,
  input: ProductUpdateInput,
): Promise<InventoryProduct | null> {
  return memoryUpdateProduct(id, input)
}

export async function deleteProduct(id: string): Promise<boolean> {
  return memoryDeleteProduct(id)
}

export async function markProductSold(id: string): Promise<MarkSoldResult> {
  return memoryMarkProductSold(id)
}
