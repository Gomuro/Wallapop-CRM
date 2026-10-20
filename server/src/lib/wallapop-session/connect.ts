import {
  closeWallapopBrowser,
  loginWallapopInBrowser,
  logoutWallapopInBrowser,
  submitWallapop2faInBrowser,
} from "../wallapop-browser"
import {
  isBrowserBusyError,
  quitChromeIfNoWorkerSlots,
  setKeepChromeWarm,
} from "../wallapop-cdp"
import { log } from "../log"
import { applyReconcileToState, bindWallapopIdentity, syncAccountStatus } from "./reconcile"
import {
  readGeneration,
  nextGeneration,
  resolveAccountTarget,
  sessionRow,
  setGeneration,
  snapshotOf,
  type AccountTarget,
  type SessionState,
  type WallapopSessionSnapshot,
} from "./state"

async function finishIfStillCurrent(
  input: { email: string; password: string; proxy?: string | null },
  target: AccountTarget,
  row: SessionState,
  gen: number,
): Promise<ConnectSessionResult> {
  const outcome = await loginWallapopInBrowser({
    email: input.email,
    password: input.password,
    proxy: input.proxy,
    cdpPort: target.port,
  })
  if (gen !== readGeneration(target.accountId)) {
    return { ok: true, session: snapshotOf(row) }
  }
  const result = await finishConnectSuccess(
    outcome,
    row,
    target.accountId,
    target.port,
  )
  if (result.ok && result.session.status === "ACTIVE") {
    await quitChromeIfNoWorkerSlots(target.port)
  }
  return result
}
export type ConnectSessionResult =
  | { ok: true; session: WallapopSessionSnapshot }
  | {
      ok: false
      session: WallapopSessionSnapshot
      message: string
      code?: "BROWSER_BUSY" | "CONNECT_FAILED"
    }

async function finishConnectSuccess(
  outcome: "ACTIVE" | "REQUIRES_2FA",
  row: SessionState,
  accountId: string,
  port: number,
): Promise<ConnectSessionResult> {
  if (outcome === "REQUIRES_2FA") {
    row.status = "AUTHENTICATING"
    row.requires2FA = true
    row.error = null
    setKeepChromeWarm(true, port)
    return { ok: true, session: snapshotOf(row) }
  }
  row.status = "ACTIVE"
  row.requires2FA = false
  row.error = null
  setKeepChromeWarm(false, port)
  await syncAccountStatus(accountId, "ACTIVE")
  const listingsReset = await bindWallapopIdentity(row, accountId)
  return { ok: true, session: { ...snapshotOf(row), listingsReset } }
}

function finishConnectFailure(
  error: unknown,
  prev: WallapopSessionSnapshot,
  row: SessionState,
): ConnectSessionResult {
  const message =
    error instanceof Error ? error.message : "Error al conectar Wallapop."
  if (isBrowserBusyError(error)) {
    row.status = prev.status
    row.requires2FA = prev.requires2FA
    row.email = prev.email
    row.error = prev.error ?? null
    log("warn", "wallapop_connect_browser_busy", { message })
    return { ok: false, session: snapshotOf(row), message, code: "BROWSER_BUSY" }
  }
  row.status = "DISCONNECTED"
  row.requires2FA = false
  row.error = message
  log("error", "wallapop_connect_failed", { message })
  return { ok: false, session: snapshotOf(row), message, code: "CONNECT_FAILED" }
}

export async function connectWallapopSession(input: {
  email: string
  password: string
  proxy?: string | null
  accountId?: string
}): Promise<ConnectSessionResult> {
  const target = await resolveAccountTarget(input.accountId)
  const row = sessionRow(target.accountId)
  const prev = snapshotOf(row)
  const gen = nextGeneration(target.accountId)
  row.status = "AUTHENTICATING"
  row.requires2FA = false
  row.email = input.email
  row.error = null
  try {
    return await finishIfStillCurrent(input, target, row, gen)
  } catch (error) {
    if (gen !== readGeneration(target.accountId)) {
      return { ok: true, session: snapshotOf(row) }
    }
    return finishConnectFailure(error, prev, row)
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

function notAuthenticatingResult(row: SessionState): Submit2faResult {
  return {
    ok: false,
    code: "NOT_AUTHENTICATING",
    message: "No hay una sesión de autenticación activa.",
    session: snapshotOf(row),
  }
}

async function finish2faSuccess(
  row: SessionState,
  accountId: string,
  port: number,
): Promise<Submit2faResult> {
  row.status = "ACTIVE"
  row.requires2FA = false
  row.error = null
  setKeepChromeWarm(false, port)
  await syncAccountStatus(accountId, "ACTIVE")
  const listingsReset = await bindWallapopIdentity(row, accountId)
  return { ok: true, session: { ...snapshotOf(row), listingsReset } }
}

function finish2faFailure(error: unknown, row: SessionState): Submit2faResult {
  const message =
    error instanceof Error ? error.message : "Error al verificar 2FA."
  if (isBrowserBusyError(error)) {
    log("warn", "wallapop_2fa_browser_busy", { message })
    return { ok: false, code: "BROWSER_BUSY", message, session: snapshotOf(row) }
  }
  row.status = "AUTHENTICATING"
  row.requires2FA = true
  row.error = message
  log("error", "wallapop_2fa_failed", { message })
  return { ok: false, code: "CONNECT_FAILED", message, session: snapshotOf(row) }
}

export async function submitWallapopSession2fa(
  code: string,
  accountId?: string,
): Promise<Submit2faResult> {
  const target = await resolveAccountTarget(accountId)
  const row = sessionRow(target.accountId)
  if (row.status !== "AUTHENTICATING" || !row.requires2FA) {
    await applyReconcileToState(row, target.accountId, target.port)
  }
  if (row.status !== "AUTHENTICATING" || !row.requires2FA) {
    return notAuthenticatingResult(row)
  }
  const gen = readGeneration(target.accountId) ?? 0
  row.error = null
  try {
    await submitWallapop2faInBrowser(code, target.port)
    if (gen !== readGeneration(target.accountId)) {
      return { ok: true, session: snapshotOf(row) }
    }
    const result = await finish2faSuccess(row, target.accountId, target.port)
    if (result.ok) await quitChromeIfNoWorkerSlots(target.port)
    return result
  } catch (error) {
    if (gen !== readGeneration(target.accountId)) {
      return { ok: true, session: snapshotOf(row) }
    }
    return finish2faFailure(error, row)
  }
}

export async function disconnectWallapopSession(
  accountId?: string,
): Promise<WallapopSessionSnapshot> {
  const target = await resolveAccountTarget(accountId)
  const row = sessionRow(target.accountId)
  const gen = nextGeneration(target.accountId)
  setKeepChromeWarm(false, target.port)
  try {
    await logoutWallapopInBrowser(target.port)
  } catch (error) {
    if (isBrowserBusyError(error)) {
      setGeneration(target.accountId, gen - 1)
      throw error
    }
    log("warn", "wallapop_disconnect_logout_error", {
      message: error instanceof Error ? error.message : String(error),
    })
    await closeWallapopBrowser(target.port)
  }
  row.status = "DISCONNECTED"
  row.requires2FA = false
  row.email = null
  row.error = null
  await syncAccountStatus(target.accountId, "INACTIVE")
  return snapshotOf(row)
}

