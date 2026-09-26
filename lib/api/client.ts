import { clientApiV1Path, getPublicApiUrl, isApiConfigured } from "@/lib/api/config"
import { ApiError } from "@/lib/api/errors"
import { jsonApiHeaders, withApiTimeout } from "@/lib/api/http"
import { parseApiError, parseJsonResponse } from "@/lib/api/parse-response"

function assertApiConfigured() {
  if (!isApiConfigured()) {
    throw new ApiError(
      503,
      "API_NOT_CONFIGURED",
      "NEXT_PUBLIC_API_URL is not set for this deployment.",
    )
  }
  const base = getPublicApiUrl()
  if (base && !base.startsWith("http://") && !base.startsWith("https://")) {
    throw new ApiError(
      503,
      "API_NOT_CONFIGURED",
      "NEXT_PUBLIC_API_URL must be an absolute http(s) URL.",
    )
  }
}

export type ApiFetchOptions = RequestInit & {
  /** Forward session to Express from Next middleware (server-only). */
  cookieHeader?: string
}

export async function apiClientFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  assertApiConfigured()
  let response: Response
  try {
    response = await fetch(
      clientApiV1Path(path),
      withApiTimeout({
        credentials: "include",
        ...init,
        headers: jsonApiHeaders(init?.headers, init?.body),
      }),
    )
  } catch {
    throw new ApiError(
      0,
      "NETWORK",
      "No se ha podido conectar con el servidor.",
    )
  }

  if (!response.ok) {
    throw await parseApiError(response)
  }

  try {
    return (await parseJsonResponse<T>(response)) as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(
      response.status,
      "INTERNAL",
      "El servidor devolvió una respuesta no válida.",
    )
  }
}

export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<{ data: T; response: Response }> {
  const { cookieHeader, ...init } = options
  const headers = jsonApiHeaders(init.headers, init.body)

  if (cookieHeader) {
    headers.set("Cookie", cookieHeader)
  }

  const credentials: RequestCredentials | undefined = cookieHeader
    ? "omit"
    : (init.credentials ?? "include")

  assertApiConfigured()
  let response: Response
  try {
    response = await fetch(
      clientApiV1Path(path),
      withApiTimeout({
        ...init,
        headers,
        credentials,
        cache: init.cache ?? "no-store",
      }),
    )
  } catch {
    throw new ApiError(
      0,
      "NETWORK",
      "No se ha podido conectar con el servidor.",
    )
  }

  if (!response.ok) {
    throw await parseApiError(response)
  }

  try {
    const data = (await parseJsonResponse<T>(response)) as T
    return { data, response }
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(
      response.status,
      "INTERNAL",
      "El servidor devolvió una respuesta no válida.",
    )
  }
}

export { ApiError }
