import { apiClientFetch } from "@/lib/api/client"
import { ApiError } from "@/lib/api/errors"

const DEVOLUCION_TIMEOUT_MS = 120_000

export type WallapopDevolucionResult = {
  ok: boolean
  dryRun: boolean
  step: string
  eliminated: boolean
  product: unknown
  error: string | null
}

export async function startWallapopDevolucion(
  productId: string,
): Promise<WallapopDevolucionResult> {
  return apiClientFetch<WallapopDevolucionResult>(
    `/products/${encodeURIComponent(productId)}/wallapop-devolucion`,
    {
      method: "POST",
      body: JSON.stringify({}),
      timeoutMs: DEVOLUCION_TIMEOUT_MS,
    },
  )
}

export function wallapopDevolucionErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "API_NOT_CONFIGURED") {
      return "La API no está configurada. Contacta con el administrador."
    }
    return error.message
  }
  return "No se pudo procesar la devolución."
}
