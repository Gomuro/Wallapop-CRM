import "server-only"

import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { isApiConfigured } from "@/lib/api/config"
import { getInternalApiUrl, internalApiV1Path } from "@/lib/api/internal"
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
  const base = getInternalApiUrl()
  if (!base.startsWith("http://") && !base.startsWith("https://")) {
    throw new ApiError(
      503,
      "API_NOT_CONFIGURED",
      "API_UPSTREAM or NEXT_PUBLIC_API_URL must be an absolute http(s) URL.",
    )
  }
}

export type ApiServerFetchOptions = RequestInit & {
  /** When true, 401 is thrown instead of redirecting to `/login`. */
  skipAuthRedirect?: boolean
}

export async function fetchInternalApi(
  path: string,
  cookie: string,
  requestInit: RequestInit,
): Promise<Response> {
  assertApiConfigured()
  const mergedHeaders = jsonApiHeaders(requestInit.headers, requestInit.body)
  mergedHeaders.set("cookie", cookie)
  try {
    return await fetch(
      internalApiV1Path(path),
      withApiTimeout({
        ...requestInit,
        headers: mergedHeaders,
        cache: "no-store",
      }),
    )
  } catch {
    throw new ApiError(
      0,
      "NETWORK",
      "No se ha podido conectar con el servidor.",
    )
  }
}

export async function parseServerApiJson<T>(response: Response): Promise<T> {
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

export async function apiServerFetch<T>(
  path: string,
  init?: ApiServerFetchOptions,
): Promise<T> {
  const headerList = await headers()
  const { skipAuthRedirect, ...requestInit } = init ?? {}
  const response = await fetchInternalApi(
    path,
    headerList.get("cookie") ?? "",
    requestInit,
  )
  if (response.status === 401 && !skipAuthRedirect) {
    redirect("/login")
  }
  return parseServerApiJson<T>(response)
}

export async function apiServerFetchSafe<T>(
  path: string,
  init?: ApiServerFetchOptions,
): Promise<{ data: T } | { error: ApiError }> {
  try {
    const data = await apiServerFetch<T>(path, {
      ...init,
      skipAuthRedirect: true,
    })
    return { data }
  } catch (error) {
    if (error instanceof ApiError) return { error }
    throw error
  }
}
