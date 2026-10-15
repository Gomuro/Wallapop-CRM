import type { WallapopConnectionStatus } from "../../../lib/validations/account"

import {
  classifyOwnedSessionWindow,
  closeWallapopBrowser,
  loginWallapopInBrowser,
  logoutWallapopInBrowser,
  reconcileWallapopBrowserState,
  submitWallapop2faInBrowser,
  type ReconcileBrowserState,
} from "./wallapop-browser"
import {
  isBrowserBusyError,
  quitChromeIfNoWorkerSlots,
  runWithBrowserBusy,
  setKeepChromeWarm,
} from "./wallapop-cdp"
import { assignChromePlaces } from "./account-chrome"
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

const sessions = new Map<string, SessionState>()
const generations = new Map<string, number>()
let defaultAccountId: string | null = null

function emptySession(): SessionState {
  return {
    status: "DISCONNECTED",
    requires2FA: false,
    email: null,
    error: null,
  }
}

function sessionRow(accountId: string): SessionState {
  let row = sessions.get(accountId)
  if (!row) {
    row = emptySession()
    sessions.set(accountId, row)
  }
  return row
}

function snapshotOf(row: SessionState): WallapopSessionSnapshot {
  return {
    status: row.status,
    requires2FA: row.requires2FA,
    email: row.email,
    ...(row.error ? { error: row.error } : {}),
  }
}

async function resolveAccountTarget(accountId?: string): Promise<{
  accountId: string
  port: number
}> {
  const prisma = getPrisma()
  if (!prisma) throw new Error("Database is not configured.")
  const accounts = await prisma.account.findMany({
    select: { id: true, isDefault: true, createdAt: true },
  })
  const fallback = accounts.find((row) => row.isDefault) ?? accounts[0]
  if (!fallback) throw new Error("Default account is not configured.")
  defaultAccountId = fallback.isDefault ? fallback.id : defaultAccountId ?? fallback.id
  const chosen = accountId ? accounts.find((row) => row.id === accountId) : fallback
  if (!chosen) throw new Error("Cuenta no encontrada.")
  if (chosen.isDefault) defaultAccountId = chosen.id
  const place = assignChromePlaces(accounts).get(chosen.id)
  return { accountId: chosen.id, port: place?.port ?? 9222 }
}

function snapshot(): WallapopSessionSnapshot {
  if (!defaultAccountId) return snapshotOf(emptySession())
  return snapshotOf(sessionRow(defaultAccountId))
}

async function bindWallapopIdentity(
  row: SessionState,
  accountId: string,
): Promise<boolean> {
  const prisma = getPrisma()
  const email = row.email
  if (!prisma || !email) return false
  try {
    const { listingsReset } = await syncWallapopIdentityOnActive(
      prisma,
      email,
      accountId,
    )
    return listingsReset
  } catch (error) {
    log("warn", "wallapop_identity_sync_failed", {
      message: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

async function syncAccountStatus(
  accountId: string,
  status: "ACTIVE" | "INACTIVE",
): Promise<void> {
  const prisma = getPrisma()
  if (!prisma) return
  try {
    await prisma.account.update({
      where: { id: accountId },
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
  row: SessionState,
  accountId: string,
): Promise<void> {
  if (reconciled === "REQUIRES_2FA") {
    row.status = "AUTHENTICATING"
    row.requires2FA = true
    row.error = null
    return
  }
  if (reconciled === "ACTIVE") {
    row.status = "ACTIVE"
    row.requires2FA = false
    row.error = null
    await syncAccountStatus(accountId, "ACTIVE")
  }
}

async function applyReconcileToState(
  row: SessionState,
  accountId: string,
  port: number,
): Promise<void> {
  await applyReconcileResult(
    await reconcileWallapopBrowserState(port),
    row,
    accountId,
  )
}

/**
 * In-memory snapshot, rehydrated from Chrome CDP when RAM was wiped (API restart)
 * but MFA / logged-in UI is still open.
 */
export async function getWallapopSessionSnapshot(
  accountId?: string,
): Promise<WallapopSessionSnapshot> {
  const target = await resolveAccountTarget(accountId)
  const row = sessionRow(target.accountId)
  if (row.requires2FA || row.status === "ACTIVE") return snapshotOf(row)
  await applyReconcileToState(row, target.accountId, target.port)
  return snapshotOf(row)
}

/**
 * Session-valid worker: own window on CDP (spawn Chrome if needed), classify, close window.
 * After ACTIVE the next worker (monitor / publish) launches Chrome if this process already quit.
 */
export async function rehydrateWallapopSessionOnBoot(): Promise<WallapopSessionSnapshot> {
  const target = await resolveAccountTarget()
  const row = sessionRow(target.accountId)
  try {
    await runWithBrowserBusy("session", async () => {
      const reconciled = await classifyOwnedSessionWindow(target.port)
      await applyReconcileResult(reconciled, row, target.accountId)
      if (reconciled === "NONE") {
        setKeepChromeWarm(false, target.port)
      }
    }, target.port)
  } catch (error) {
    if (isBrowserBusyError(error)) {
      log("info", "wallapop_session_rehydrate_skipped_busy", {
        busy: error.busyWith,
      })
    } else {
      throw error
    }
  }
  if (!row.requires2FA) {
    await quitChromeIfNoWorkerSlots(target.port)
  }
  return snapshotOf(row)
}

/** @deprecated Prefer getWallapopSessionSnapshot — sync view without CDP rehydrate. */
export function getWallapopSession(): WallapopSessionSnapshot {
  return snapshot()
}

export function peekWallapopSession(accountId: string): WallapopSessionSnapshot {
  const row = sessions.get(accountId)
  if (!row) return snapshotOf(emptySession())
  return snapshotOf(row)
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
  const gen = (generations.get(target.accountId) ?? 0) + 1
  generations.set(target.accountId, gen)
  row.status = "AUTHENTICATING"
  row.requires2FA = false
  row.email = input.email
  row.error = null
  try {
    const outcome = await loginWallapopInBrowser({
      email: input.email,
      password: input.password,
      proxy: input.proxy,
      cdpPort: target.port,
    })
    if (gen !== generations.get(target.accountId)) {
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
  } catch (error) {
    if (gen !== generations.get(target.accountId)) {
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
  const gen = generations.get(target.accountId) ?? 0
  row.error = null
  try {
    await submitWallapop2faInBrowser(code, target.port)
    if (gen !== generations.get(target.accountId)) {
      return { ok: true, session: snapshotOf(row) }
    }
    const result = await finish2faSuccess(row, target.accountId, target.port)
    if (result.ok) await quitChromeIfNoWorkerSlots(target.port)
    return result
  } catch (error) {
    if (gen !== generations.get(target.accountId)) {
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
  const gen = (generations.get(target.accountId) ?? 0) + 1
  generations.set(target.accountId, gen)
  setKeepChromeWarm(false, target.port)
  try {
    await logoutWallapopInBrowser(target.port)
  } catch (error) {
    if (isBrowserBusyError(error)) {
      generations.set(target.accountId, gen - 1)
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
