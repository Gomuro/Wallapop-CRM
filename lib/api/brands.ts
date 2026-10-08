import { apiClientFetch } from "@/lib/api/client"

export async function apiListBrands(
  categoryId: string,
  q?: string,
): Promise<string[]> {
  const params = new URLSearchParams()
  params.set("categoryId", categoryId)
  const query = q?.trim() ?? ""
  if (query) params.set("q", query)
  const { brands } = await apiClientFetch<{ brands: string[] }>(
    `/brands?${params}`,
  )
  return Array.isArray(brands) ? brands : []
}
