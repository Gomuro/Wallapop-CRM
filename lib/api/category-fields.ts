import { apiClientFetch } from "@/lib/api/client"
import type { CategoryUploadField } from "@/lib/inventory/category-upload-fields"
import { extraUploadFields } from "@/lib/inventory/category-upload-fields"

export async function apiGetCategoryFields(
  categoryId: string,
): Promise<CategoryUploadField[]> {
  const { category } = await apiClientFetch<{
    category: { fields?: CategoryUploadField[] }
  }>(`/categories/${encodeURIComponent(categoryId)}`)
  return extraUploadFields(category?.fields ?? [])
}
