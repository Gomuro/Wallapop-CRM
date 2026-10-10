import { ApiError, type ApiErrorCode } from "./errors"

export function isJsonContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false
  return /application\/json|application\/problem\+json/i.test(contentType)
}

export function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart()
  return trimmed.startsWith("{") || trimmed.startsWith("[")
}

export function codeForHttpStatus(status: number): ApiErrorCode {
  if (status === 413) return "PAYLOAD_TOO_LARGE"
  if (status === 401 || status === 403) return "UNAUTHORIZED"
  if (status === 404) return "NOT_FOUND"
  if (status === 0 || status === 408 || status >= 502) return "NETWORK"
  return "INTERNAL"
}

const HTTP_TIMEOUT_MESSAGE =
  "El servidor no ha respondido a tiempo. Inténtalo de nuevo."
const HTTP_UNAVAILABLE_MESSAGE =
  "El servidor no está disponible. Inténtalo de nuevo."
const HTTP_STATUS_MESSAGES: Record<number, string> = {
  413: "Las fotos son demasiado pesadas. Reduce el tamaño e inténtalo de nuevo.",
  408: HTTP_TIMEOUT_MESSAGE,
  504: HTTP_TIMEOUT_MESSAGE,
  502: HTTP_UNAVAILABLE_MESSAGE,
  503: HTTP_UNAVAILABLE_MESSAGE,
}

export function messageForHttpStatus(status: number): string {
  return HTTP_STATUS_MESSAGES[status] ?? "Algo ha salido mal. Inténtalo de nuevo."
}

type ErrorBody = {
  error?: { code?: string; message?: string }
}

export function apiErrorFromBody(
  status: number,
  contentType: string | null | undefined,
  text: string,
): ApiError {
  const fallback = messageForHttpStatus(status)
  if (text && (isJsonContentType(contentType) || looksLikeJson(text))) {
    try {
      const body = JSON.parse(text) as ErrorBody
      const code = (body.error?.code as ApiErrorCode | undefined) ?? codeForHttpStatus(status)
      const message = body.error?.message || fallback
      return new ApiError(status, code, message)
    } catch {
      // HTML or truncated JSON with a misleading content-type.
    }
  }
  return new ApiError(status, codeForHttpStatus(status), fallback)
}

export function parseJsonText<T>(
  status: number,
  contentType: string | null | undefined,
  text: string,
): T | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined

  if (!isJsonContentType(contentType) && !looksLikeJson(trimmed)) {
    throw new ApiError(status, codeForHttpStatus(status), messageForHttpStatus(status))
  }

  try {
    return JSON.parse(trimmed) as T
  } catch {
    throw new ApiError(
      status,
      codeForHttpStatus(status),
      "El servidor devolvió una respuesta no válida.",
    )
  }
}

export async function parseJsonResponse<T>(
  response: Response,
): Promise<T | undefined> {
  if (response.status === 204) return undefined
  const text = await response.text()
  if (!text) return undefined
  return parseJsonText<T>(
    response.status,
    response.headers.get("content-type"),
    text,
  )
}

export async function parseApiError(response: Response): Promise<ApiError> {
  const text = await response.text()
  return apiErrorFromBody(
    response.status,
    response.headers.get("content-type"),
    text,
  )
}
