import { apiClientFetch } from "@/lib/api/client"
import { ApiError } from "@/lib/api/errors"

const ELIMINAR_TIMEOUT_MS = 120_000

export type WallapopEliminarResult = {
  ok: boolean
  dryRun: boolean
  step: string
  product: unknown
  error: string | null
}

/** Live vs dry-run follows `WALLAPOP_ELIMINAR_DRY_RUN` on the API. */
export async function eliminarWallapopListing(
  productId: string,
): Promise<WallapopEliminarResult> {
  return apiClientFetch<WallapopEliminarResult>(
    `/products/${encodeURIComponent(productId)}/wallapop-eliminar`,
    {
      method: "POST",
      body: JSON.stringify({}),
      timeoutMs: ELIMINAR_TIMEOUT_MS,
    },
  )
}

export function wallapopEliminarErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "API_NOT_CONFIGURED") {
      return "La API no está configurada. Contacta con el administrador."
    }
    return error.message
  }
  return "No se pudo eliminar el anuncio en Wallapop."
}
