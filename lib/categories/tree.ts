import type { ApiCategory } from "@/lib/api/types"

export function childrenOf(
  categories: ApiCategory[],
  parentId: string | null,
): ApiCategory[] {
  return categories
    .filter((item) => item.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

export function categoryBreadcrumb(
  categories: ApiCategory[],
  leafId: string,
): ApiCategory[] {
  const byId = new Map(categories.map((item) => [item.id, item]))
  const path: ApiCategory[] = []
  let current = byId.get(leafId)
  while (current) {
    path.unshift(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return path
}
