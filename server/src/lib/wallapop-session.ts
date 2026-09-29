import type { WallapopConnectionStatus } from "../../../lib/validations/account"

import {
  closeWallapopBrowser,
  loginWallapopInBrowser,
  logoutWallapopInBrowser,
  reconcileWallapopBrowserState,
  reconcileWallapopBrowserStateSpawning,
  submitWallapop2faInBrowser,
  type ReconcileBrowserState,
} from "./wallapop-browser"
import { isBrowserBusyError, runWithBrowserBusy } from "./wallapop-cdp"
import { getPrisma } from "./db"
import { log } from "./log"
import { syncWallapopIdentityOnActive } from "./wallapop-account-identity"

export type WallapopSessionSnapshot = {
  status: WallapopConnectionStatus
  requires2FA: boolean
  email: string | null
  error?: string
  listingsReset?: boolean
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

/** Bumped on disconnect so in-flight connect/2FA cannot overwrite cleared state. */
let connectGeneration = 0

function snapshot(): WallapopSessionSnapshot {
  return {
    status: state.status,
    requires2FA: state.requires2FA,
    email: state.email,
    ...(state.error ? { error: state.error } : {}),
  }
}

async function bindWallapopIdentity(): Promise<boolean> {
  const prisma = getPrisma()
  const email = state.email
  if (!prisma || !email) return false
  try {
    const { listingsReset } = await syncWallapopIdentityOnActive(prisma, email)
    return listingsReset
  } catch (error) {
    log("warn", "wallapop_identity_sync_failed", {
      message: error instanceof Error ? error.message : String(error),
    })
    return false
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

async function applyReconcileResult(
  reconciled: ReconcileBrowserState,
): Promise<void> {
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

async function applyReconcileToState(): Promise<void> {
  await applyReconcileResult(await reconcileWallapopBrowserState())
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

/**
 * API boot: attach or spawn Chrome CDP, then classify session into RAM.
 * Fire-and-forget from listen — does not block boot.
 */
export async function rehydrateWallapopSessionOnBoot(): Promise<WallapopSessionSnapshot> {
  try {
    await runWithBrowserBusy("rehydrate", async () => {
      await applyReconcileResult(await reconcileWallapopBrowserStateSpawning())
    })
  } catch (error) {
    if (isBrowserBusyError(error)) {
      log("info", "wallapop_session_rehydrate_skipped_busy", {
        busy: error.busyWith,
      })
    } else {
      throw error
    }
  }
  return snapshot()
}

/** @deprecated Prefer getWallapopSessionSnapshot — sync view without CDP rehydrate. */
export function getWallapopSession(): WallapopSessionSnapshot {
  return snapshot()
}

export type ConnectSessionResult =
  | { ok: true; session: WallapopSessionSnapshot }
  | {
      ok: false
      session: WallapopSessionSnapshot
      message: string
      code?: "BROWSER_BUSY" | "CONNECT_FAILED"
    }

export async function connectWallapopSession(input: {
  email: string
  password: string
  proxy?: string | null
}): Promise<ConnectSessionResult> {
  const prev = snapshot()
  const gen = ++connectGeneration
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

    if (gen !== connectGeneration) {
      return { ok: true, session: snapshot() }
    }

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
    const listingsReset = await bindWallapopIdentity()
    return { ok: true, session: { ...snapshot(), listingsReset } }
  } catch (error) {
    if (gen !== connectGeneration) {
      return { ok: true, session: snapshot() }
    }
    const message =
      error instanceof Error ? error.message : "Error al conectar Wallapop."
    if (isBrowserBusyError(error)) {
      state.status = prev.status
      state.requires2FA = prev.requires2FA
      state.email = prev.email
      state.error = prev.error ?? null
      log("warn", "wallapop_connect_browser_busy", { message })
      return {
        ok: false,
        session: snapshot(),
        message,
        code: "BROWSER_BUSY",
      }
    }
    state.status = "DISCONNECTED"
    state.requires2FA = false
    state.error = message
    log("error", "wallapop_connect_failed", { message })
    return {
      ok: false,
      session: snapshot(),
      message,
      code: "CONNECT_FAILED",
    }
  }
}

export type Submit2faResult =
  | { ok: true; session: WallapopSessionSnapshot }
  | {
      ok: false
      code: "NOT_AUTHENTICATING" | "CONNECT_FAILED" | "BROWSER_BUSY"
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

  const gen = connectGeneration
  state.error = null

  try {
    await submitWallapop2faInBrowser(code)
    if (gen !== connectGeneration) {
      return { ok: true, session: snapshot() }
    }
    state.status = "ACTIVE"
    state.requires2FA = false
    state.error = null
    await syncDefaultAccountStatus("ACTIVE")
    const listingsReset = await bindWallapopIdentity()
    return { ok: true, session: { ...snapshot(), listingsReset } }
  } catch (error) {
    if (gen !== connectGeneration) {
      return { ok: true, session: snapshot() }
    }
    const message =
      error instanceof Error ? error.message : "Error al verificar 2FA."
    if (isBrowserBusyError(error)) {
      log("warn", "wallapop_2fa_browser_busy", { message })
      return {
        ok: false,
        code: "BROWSER_BUSY",
        message,
        session: snapshot(),
      }
    }
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
  connectGeneration += 1
  try {
    await logoutWallapopInBrowser()
  } catch (error) {
    if (isBrowserBusyError(error)) {
      connectGeneration -= 1
      throw error
    }
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
