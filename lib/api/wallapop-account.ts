import { apiClientFetch } from "@/lib/api/client"
import { ApiError } from "@/lib/api/errors"

/** Browser launch + Wallapop login can exceed the default 25s API timeout. */
const CONNECT_TIMEOUT_MS = 90_000

export type WallapopConnectionStatus =
  | "DISCONNECTED"
  | "AUTHENTICATING"
  | "ACTIVE"

export type WallapopAccountSession = {
  status: WallapopConnectionStatus
  requires2FA: boolean
  email: string | null
  error?: string
}

export async function getWallapopAccountStatus() {
  return apiClientFetch<WallapopAccountSession>("/accounts/status")
}

export async function connectWallapopAccount(input: {
  email: string
  password: string
  proxy?: string
}) {
  return apiClientFetch<WallapopAccountSession>("/accounts/connect", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      proxy: input.proxy?.trim() ? input.proxy.trim() : null,
    }),
    timeoutMs: CONNECT_TIMEOUT_MS,
  })
}

export async function submitWallapop2fa(code: string) {
  return apiClientFetch<WallapopAccountSession>("/accounts/connect/2fa", {
    method: "POST",
    body: JSON.stringify({ code }),
    timeoutMs: CONNECT_TIMEOUT_MS,
  })
}

export async function disconnectWallapopAccount() {
  return apiClientFetch<WallapopAccountSession>("/accounts/disconnect", {
    method: "POST",
    timeoutMs: 60_000,
  })
}

export function wallapopAccountErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "API_NOT_CONFIGURED") {
      return "La API no está configurada. Contacta con el administrador."
    }
    if (error.code === "NETWORK") return error.message
    return error.message
  }
  return "No se ha podido completar la operación. Inténtalo de nuevo."
}
