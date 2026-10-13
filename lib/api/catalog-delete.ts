import { apiClientFetch } from "@/lib/api/client"
import { ApiError } from "@/lib/api/errors"

const CATALOG_DELETE_TIMEOUT_MS = 120_000

export type CatalogDeleteResult = {
  ok: boolean
  dryRun: boolean
  deleted: boolean
  error: string | null
}

/** Removes the Wallapop ad when it is still up, then the CRM row. */
export async function deleteProductFromCatalog(
  productId: string,
): Promise<CatalogDeleteResult> {
  return apiClientFetch<CatalogDeleteResult>(
    `/products/${encodeURIComponent(productId)}/catalog-delete`,
    {
      method: "POST",
      body: JSON.stringify({}),
      timeoutMs: CATALOG_DELETE_TIMEOUT_MS,
    },
  )
}

export function catalogDeleteErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  return "No se pudo eliminar el producto."
}
