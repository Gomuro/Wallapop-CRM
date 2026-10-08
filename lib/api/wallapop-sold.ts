import { apiClientFetch } from "@/lib/api/client"
import { ApiError } from "@/lib/api/errors"

const SOLD_TIMEOUT_MS = 120_000

export type WallapopSoldResult = {
  ok: boolean
  dryRun: boolean
  step: string
  product: unknown
  error: string | null
}

/** Live vs dry-run follows `WALLAPOP_SOLD_DRY_RUN` on the API. */
export async function markWallapopSold(
  productId: string,
): Promise<WallapopSoldResult> {
  return apiClientFetch<WallapopSoldResult>(
    `/products/${encodeURIComponent(productId)}/wallapop-sold`,
    {
      method: "POST",
      body: JSON.stringify({}),
      timeoutMs: SOLD_TIMEOUT_MS,
    },
  )
}

export function wallapopSoldErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "API_NOT_CONFIGURED") {
      return "La API no está configurada. Contacta con el administrador."
    }
    return error.message
  }
  return "No se pudo marcar como vendido en Wallapop."
}
