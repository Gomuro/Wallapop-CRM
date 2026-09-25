import "server-only"

import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { apiV1Path } from "@/lib/api/config"
import { ApiError, parseApiError } from "@/lib/api/errors"

export type ApiServerFetchOptions = RequestInit & {
  /** When true, 401 is thrown instead of redirecting to `/login`. */
  skipAuthRedirect?: boolean
}

export async function apiServerFetch<T>(
  path: string,
  init?: ApiServerFetchOptions,
): Promise<T> {
  const headerList = await headers()
  const cookie = headerList.get("cookie") ?? ""
  const url = apiV1Path(path)

  const { skipAuthRedirect, ...requestInit } = init ?? {}
  const mergedHeaders = new Headers(requestInit.headers)
  mergedHeaders.set("accept", "application/json")
  mergedHeaders.set("cookie", cookie)
  if (
    requestInit.body != null &&
    !(requestInit.body instanceof FormData) &&
    !mergedHeaders.has("content-type")
  ) {
    mergedHeaders.set("content-type", "application/json")
  }

  const response = await fetch(url, {
    ...requestInit,
    headers: mergedHeaders,
    cache: "no-store",
  })

  if (response.status === 401 && !skipAuthRedirect) {
    redirect("/login")
  }

  if (!response.ok) {
    throw await parseApiError(response)
  }

  if (response.status === 204) {
    return undefined as T
  }

  const text = await response.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
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
