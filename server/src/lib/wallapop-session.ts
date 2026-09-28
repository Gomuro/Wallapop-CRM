import type { WallapopConnectionStatus } from "../../../lib/validations/account"

import {
  closeWallapopBrowser,
  loginWallapopInBrowser,
  logoutWallapopInBrowser,
  reconcileWallapopBrowserState,
  submitWallapop2faInBrowser,
} from "./wallapop-browser"
import { getPrisma } from "./db"
import { log } from "./log"

export type WallapopSessionSnapshot = {
  status: WallapopConnectionStatus
  requires2FA: boolean
  email: string | null
  error?: string
}

type SessionState = {
  status: WallapopConnectionStatus
  requires2FA: boolean
  email: string | null
  error: string | null
}

const state: SessionState = {
  status: "DISCONNECTED",
  requires2FA: false,
  email: null,
  error: null,
}

function snapshot(): WallapopSessionSnapshot {
  return {
    status: state.status,
    requires2FA: state.requires2FA,
    email: state.email,
    ...(state.error ? { error: state.error } : {}),
  }
}

async function syncDefaultAccountStatus(
  status: "ACTIVE" | "INACTIVE",
): Promise<void> {
  const prisma = getPrisma()
  if (!prisma) return
  try {
    await prisma.account.updateMany({
      where: { isDefault: true },
      data: { status },
    })
  } catch (error) {
    log("warn", "wallapop_account_status_sync_failed", {
      status,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

async function applyReconcileToState(): Promise<void> {
  const reconciled = await reconcileWallapopBrowserState()
  if (reconciled === "REQUIRES_2FA") {
    state.status = "AUTHENTICATING"
    state.requires2FA = true
    state.error = null
    return
  }
  if (reconciled === "ACTIVE") {
    state.status = "ACTIVE"
    state.requires2FA = false
    state.error = null
    await syncDefaultAccountStatus("ACTIVE")
    return
  }
}

/**
 * In-memory snapshot, rehydrated from Chrome CDP when RAM was wiped (API restart)
 * but MFA / logged-in UI is still open.
 */
export async function getWallapopSessionSnapshot(): Promise<WallapopSessionSnapshot> {
  if (state.requires2FA || state.status === "ACTIVE") {
    return snapshot()
  }
  await applyReconcileToState()
  return snapshot()
}

/** @deprecated Prefer getWallapopSessionSnapshot — sync view without CDP rehydrate. */
export function getWallapopSession(): WallapopSessionSnapshot {
  return snapshot()
}

export type ConnectSessionResult =
  | { ok: true; session: WallapopSessionSnapshot }
  | { ok: false; session: WallapopSessionSnapshot; message: string }

export async function connectWallapopSession(input: {
  email: string
  password: string
  proxy?: string | null
}): Promise<ConnectSessionResult> {
  state.status = "AUTHENTICATING"
  state.requires2FA = false
  state.email = input.email
  state.error = null

  try {
    const outcome = await loginWallapopInBrowser({
      email: input.email,
      password: input.password,
      proxy: input.proxy,
    })

    if (outcome === "REQUIRES_2FA") {
      state.status = "AUTHENTICATING"
      state.requires2FA = true
      state.error = null
      return { ok: true, session: snapshot() }
    }

    state.status = "ACTIVE"
    state.requires2FA = false
    state.error = null
    await syncDefaultAccountStatus("ACTIVE")
    return { ok: true, session: snapshot() }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error al conectar Wallapop."
    state.status = "DISCONNECTED"
    state.requires2FA = false
    state.error = message
    log("error", "wallapop_connect_failed", { message })
    return { ok: false, session: snapshot(), message }
  }
}

export type Submit2faResult =
  | { ok: true; session: WallapopSessionSnapshot }
  | {
      ok: false
      code: "NOT_AUTHENTICATING" | "CONNECT_FAILED"
      message: string
      session: WallapopSessionSnapshot
    }

export async function submitWallapopSession2fa(
  code: string,
): Promise<Submit2faResult> {
  if (state.status !== "AUTHENTICATING" || !state.requires2FA) {
    await applyReconcileToState()
  }

  if (state.status !== "AUTHENTICATING" || !state.requires2FA) {
    return {
      ok: false,
      code: "NOT_AUTHENTICATING",
      message: "No hay una sesión de autenticación activa.",
      session: snapshot(),
    }
  }

  state.error = null

  try {
    await submitWallapop2faInBrowser(code)
    state.status = "ACTIVE"
    state.requires2FA = false
    state.error = null
    await syncDefaultAccountStatus("ACTIVE")
    return { ok: true, session: snapshot() }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error al verificar 2FA."
    state.status = "AUTHENTICATING"
    state.requires2FA = true
    state.error = message
    log("error", "wallapop_2fa_failed", { message })
    return {
      ok: false,
      code: "CONNECT_FAILED",
      message,
      session: snapshot(),
    }
  }
}

export async function disconnectWallapopSession(): Promise<WallapopSessionSnapshot> {
  try {
    await logoutWallapopInBrowser()
  } catch (error) {
    log("warn", "wallapop_disconnect_logout_error", {
      message: error instanceof Error ? error.message : String(error),
    })
    await closeWallapopBrowser()
  }
  state.status = "DISCONNECTED"
  state.requires2FA = false
  state.email = null
  state.error = null
  await syncDefaultAccountStatus("INACTIVE")
  return snapshot()
}
