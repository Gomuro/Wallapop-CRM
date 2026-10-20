import { apiClientFetch } from "@/lib/api/client"
import { ApiError } from "@/lib/api/errors"
import type { ApiDefaultAccountResponse } from "@/lib/api/types"
import type { AutopostIntervalPatchInput } from "@/lib/validations/account"

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
  listingsReset?: boolean
}

function accountQuery(accountId?: string): string {
  if (!accountId) return ""
  return `?accountId=${encodeURIComponent(accountId)}`
}

export async function getWallapopAccountStatus(accountId?: string) {
  return apiClientFetch<WallapopAccountSession>(`/accounts/status${accountQuery(accountId)}`)
}

export async function connectWallapopAccount(input: {
  email: string
  password: string
  proxy?: string
  accountId?: string
}) {
  return apiClientFetch<WallapopAccountSession>("/accounts/connect", {
    method: "POST",
    body: JSON.stringify({
      accountId: input.accountId,
      email: input.email,
      password: input.password,
      proxy: input.proxy?.trim() ? input.proxy.trim() : null,
    }),
    timeoutMs: CONNECT_TIMEOUT_MS,
  })
}

export async function submitWallapop2fa(code: string, accountId?: string) {
  return apiClientFetch<WallapopAccountSession>("/accounts/connect/2fa", {
    method: "POST",
    body: JSON.stringify({ code, accountId }),
    timeoutMs: CONNECT_TIMEOUT_MS,
  })
}

export async function applyWallapopAccountProxy(input: {
  proxy?: string
  accountId?: string
}) {
  return apiClientFetch<WallapopAccountSession>("/accounts/proxy", {
    method: "POST",
    body: JSON.stringify({
      accountId: input.accountId,
      proxy: input.proxy?.trim() ? input.proxy.trim() : null,
    }),
    timeoutMs: 60_000,
  })
}

export async function disconnectWallapopAccount(accountId?: string) {
  return apiClientFetch<WallapopAccountSession>("/accounts/disconnect", {
    method: "POST",
    body: JSON.stringify({ accountId }),
    timeoutMs: 60_000,
  })
}

export async function getDefaultAccountAutopost() {
  return apiClientFetch<ApiDefaultAccountResponse>("/accounts/default")
}

export async function getAccountAutopost(accountId: string) {
  return apiClientFetch<ApiDefaultAccountResponse>(`/accounts/${accountId}/autopost`)
}

export async function updateAutopostInterval(
  input: AutopostIntervalPatchInput,
  accountId?: string,
) {
  const path = accountId
    ? `/accounts/${accountId}/autopost`
    : "/accounts/default/autopost"
  return apiClientFetch<ApiDefaultAccountResponse>(path, {
    method: "PATCH",
    body: JSON.stringify(input),
  })
}

export async function startAutopost(accountId?: string) {
  const path = accountId
    ? `/accounts/${accountId}/autopost/start`
    : "/accounts/default/autopost/start"
  return apiClientFetch<ApiDefaultAccountResponse>(path, { method: "POST" })
}

export async function stopAutopost(accountId?: string) {
  const path = accountId
    ? `/accounts/${accountId}/autopost/stop`
    : "/accounts/default/autopost/stop"
  return apiClientFetch<ApiDefaultAccountResponse>(path, { method: "POST" })
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
