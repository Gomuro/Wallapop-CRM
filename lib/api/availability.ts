import { ApiError } from "@/lib/api/errors"

import { isApiConfigured } from "./config"

export type ApiUnavailableReason = "config" | "unreachable"

export function apiUnavailableReason(
  error?: unknown,
): ApiUnavailableReason | null {
  if (!isApiConfigured()) return "config"
  if (!error) return null
  if (error instanceof ApiError) {
    if (error.code === "API_NOT_CONFIGURED") return "config"
    if (
      error.code === "NETWORK" ||
      error.status === 0 ||
      error.status >= 502 ||
      error.status === 404
    ) {
      return "unreachable"
    }
  }
  return "unreachable"
}

export function isApiUnavailableError(error: unknown): boolean {
  return apiUnavailableReason(error) !== null
}

/** Network, timeout, CORS, or upstream outage. Validation and auth errors are excluded. */
export function isTransportFailure(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false
  if (error.code === "NETWORK") return true
  if (error.status === 0 || error.status === 404 || error.status === 408) return true
  if (error.status >= 500) return true
  return false
}
