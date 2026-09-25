import "server-only"

import { apiServerFetch } from "@/lib/api/server"
import type { ApiCategory } from "@/lib/api/types"

export async function apiListCategories(
  parentId?: string,
): Promise<ApiCategory[]> {
  const qs =
    parentId === undefined
      ? ""
      : `?parentId=${encodeURIComponent(parentId)}`
  const { categories } = await apiServerFetch<{ categories: ApiCategory[] }>(
    `/categories${qs}`,
  )
  return categories
}

export async function apiGetCategory(id: string): Promise<ApiCategory> {
  const { category } = await apiServerFetch<{ category: ApiCategory }>(
    `/categories/${id}`,
  )
  return category
}

export { childrenOf, categoryBreadcrumb } from "@/lib/categories/tree"
