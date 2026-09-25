import { apiV1Path } from "@/lib/api/config"
import { ApiError, parseApiError } from "@/lib/api/errors"

export type ApiFetchOptions = RequestInit & {
  /** Forward session to Express from Next middleware (server-only). */
  cookieHeader?: string
}

async function readJson<T>(response: Response): Promise<T | undefined> {
  if (response.status === 204) return undefined
  const text = await response.text()
  if (!text) return undefined
  return JSON.parse(text) as T
}

export async function apiClientFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(apiV1Path(path), {
    credentials: "include",
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.body instanceof FormData
        ? {}
        : init?.body
          ? { "content-type": "application/json" }
          : {}),
      ...init?.headers,
    },
  })

  if (!response.ok) {
    throw await parseApiError(response)
  }

  return (await readJson<T>(response)) as T
}

export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<{ data: T; response: Response }> {
  const { cookieHeader, ...init } = options
  const headers = new Headers({
    accept: "application/json",
    ...(init.headers as HeadersInit),
  })

  if (cookieHeader) {
    headers.set("Cookie", cookieHeader)
  }

  const hasBody = init.body !== undefined && init.body !== null
  if (
    hasBody &&
    !(init.body instanceof FormData) &&
    !headers.has("content-type")
  ) {
    headers.set("content-type", "application/json")
  }

  const credentials: RequestCredentials | undefined = cookieHeader
    ? "omit"
    : (init.credentials ?? "include")

  let response: Response
  try {
    response = await fetch(apiV1Path(path), {
      ...init,
      headers,
      credentials,
      cache: init.cache ?? "no-store",
    })
  } catch {
    throw new ApiError(0, "NETWORK", "Не вдалося підключитися до сервера")
  }

  if (!response.ok) {
    throw await parseApiError(response)
  }

  const data = (await readJson<T>(response)) as T
  return { data, response }
}

export { ApiError }
