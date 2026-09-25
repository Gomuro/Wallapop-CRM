export const API_TIMEOUT_MS = 25_000

export function withApiTimeout(init: RequestInit = {}): RequestInit {
  const timeout = AbortSignal.timeout(API_TIMEOUT_MS)
  if (!init.signal || typeof AbortSignal.any !== "function") {
    return { ...init, signal: timeout }
  }
  return { ...init, signal: AbortSignal.any([init.signal, timeout]) }
}

export function jsonApiHeaders(
  headersInit: HeadersInit | undefined,
  body: BodyInit | null | undefined,
): Headers {
  const headers = new Headers(headersInit)
  headers.set("Accept", "application/json")
  const isForm =
    typeof FormData !== "undefined" && body instanceof FormData
  if (!isForm) {
    headers.set("Content-Type", "application/json")
  }
  return headers
}
