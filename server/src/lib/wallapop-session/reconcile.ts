import type { ReconcileBrowserState } from "../wallapop-browser"
import {
  classifyOwnedSessionWindow,
  reconcileWallapopBrowserState,
} from "../wallapop-browser"
import {
  isBrowserBusyError,
  quitChromeIfNoWorkerSlots,
  runWithBrowserBusy,
  setKeepChromeWarm,
} from "../wallapop-cdp"
import { assignChromePlaces } from "../account-chrome"
import { getPrisma } from "../db"
import { log } from "../log"
import { syncWallapopIdentityOnActive } from "../wallapop-account-identity"
import { markSessionProbed, shouldProbeSession } from "./probe-backoff"
import { snapshotWithChromeProxy } from "./proxy"
import {
  resolveAccountTarget,
  sessionRow,
  snapshotOf,
  type SessionState,
  type WallapopSessionSnapshot,
} from "./state"

export async function bindWallapopIdentity(
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

export async function syncAccountStatus(
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

export const WALLAPOP_LOGGED_OUT_MESSAGE =
  "La sesión de Wallapop se ha cerrado. Entra en Cuenta e inicia sesión para publicar y reservar."

/** Drop a session the server still remembers as logged in. 2FA stays open. */
export async function markWallapopSessionLoggedOut(accountId?: string): Promise<void> {
  const target = await resolveAccountTarget(accountId)
  const row = sessionRow(target.accountId)
  if (row.requires2FA || row.status === "AUTHENTICATING") return
  if (row.error === WALLAPOP_LOGGED_OUT_MESSAGE) return
  row.status = "DISCONNECTED"
  row.requires2FA = false
  row.error = WALLAPOP_LOGGED_OUT_MESSAGE
  log("warn", "wallapop_session_logged_out", { accountId: target.accountId })
  await syncAccountStatus(target.accountId, "INACTIVE")
}

async function rememberSavedEmail(row: SessionState, accountId: string): Promise<void> {
  if (row.email) return
  const prisma = getPrisma()
  if (!prisma) return
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { wallapopEmail: true },
  })
  if (account?.wallapopEmail) row.email = account.wallapopEmail
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
    await rememberSavedEmail(row, accountId)
    await syncAccountStatus(accountId, "ACTIVE")
  }
}

/** Open this account's saved Chrome profile, classify, then close the window. */
async function rehydrateAccountSession(accountId: string, port: number): Promise<void> {
  const row = sessionRow(accountId)
  if (row.requires2FA || row.status === "ACTIVE") return
  if (!shouldProbeSession(accountId, row.status)) return
  try {
    await runWithBrowserBusy(
      "session",
      async () => {
        markSessionProbed(accountId)
        const reconciled = await classifyOwnedSessionWindow(port)
        await applyReconcileResult(reconciled, row, accountId)
        if (reconciled === "NONE") setKeepChromeWarm(false, port)
      },
      port,
    )
  } catch (error) {
    if (isBrowserBusyError(error)) {
      log("info", "wallapop_session_rehydrate_skipped_busy", {
        accountId,
        port,
        busy: error.busyWith,
      })
      return
    }
    throw error
  }
  if (!row.requires2FA) await quitChromeIfNoWorkerSlots(port)
}

export async function rehydrateSavedAccountSessions(): Promise<void> {
  const prisma = getPrisma()
  if (!prisma) return
  const accounts = await prisma.account.findMany({
    select: { id: true, isDefault: true, createdAt: true, chromeSlot: true },
  })
  const places = assignChromePlaces(accounts)
  await Promise.all(
    accounts.map(async (account) => {
      const port = places.get(account.id)?.port
      if (port == null) return
      await rehydrateAccountSession(account.id, port)
    }),
  )
}

export async function applyReconcileToState(
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
  await rehydrateAccountSession(target.accountId, target.port)
  return snapshotWithChromeProxy(
    target.accountId,
    snapshotOf(sessionRow(target.accountId)),
  )
}

/**
 * Session-valid worker: own window on CDP (spawn Chrome if needed), classify, close window.
 * After ACTIVE the next worker (monitor / publish) launches Chrome if this process already quit.
 */
export async function rehydrateWallapopSessionOnBoot(): Promise<WallapopSessionSnapshot> {
  const target = await resolveAccountTarget()
  await rehydrateAccountSession(target.accountId, target.port)
  return snapshotWithChromeProxy(
    target.accountId,
    snapshotOf(sessionRow(target.accountId)),
  )
}

