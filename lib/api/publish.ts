import { apiClientFetch } from "@/lib/api/client"
import { ApiError } from "@/lib/api/errors"

/** Browser publish flow can exceed the default API timeout. */
const PUBLISH_TIMEOUT_MS = 120_000

export type PublishProductResult = {
  ok: boolean
  dryRun: boolean
  listing: unknown
  error: string | null
  step: string
}

export async function publishProductDryRun(
  productId: string,
): Promise<PublishProductResult> {
  return apiClientFetch<PublishProductResult>(
    `/products/${encodeURIComponent(productId)}/publish`,
    {
      method: "POST",
      body: JSON.stringify({ dryRun: true }),
      timeoutMs: PUBLISH_TIMEOUT_MS,
    },
  )
}

export function publishErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "API_NOT_CONFIGURED") {
      return "La API no está configurada. Contacta con el administrador."
    }
    if (error.code === "NETWORK") return error.message
    return error.message
  }
  return "No se ha podido completar la prueba de publicación."
}
