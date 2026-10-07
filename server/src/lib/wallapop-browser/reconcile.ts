/**
 * Wallapop 2FA submit and CDP session reconcile.
 */
import type { Page } from "playwright"

import {
  attachOrLaunch,
  BrowserBusyError,
  closeWallapopBrowser,
  connectCdpHandle,
  CDP_URL,
  dismissWallapopConsent,
  firstVisible,
  getBrowserBusy,
  getWallapopHandle,
  NAV_TIMEOUT_MS,
  runWithBrowserBusy,
  setWallapopHandle,
} from "../wallapop-cdp"
import { log } from "../log"
import {
  detect2FA,
  detectLoggedIn,
  SELECTORS,
  waitForLoginOutcome,
  type BrowserLoginOutcome,
} from "./login"

/** Session probe when Chrome has no Wallapop tab (e.g. New Tab after spawn). */
const PROBE_URL = "https://es.wallapop.com/wall"

function preferLoggedInPage(pages: Page[], fallback: Page): Page {
  const wall = pages.find((p) => {
    try {
      const url = p.url().toLowerCase()
      return (
        url.includes("es.wallapop.com") &&
        url.includes("/wall") &&
        !url.includes("accounts.wallapop.com")
      )
    } catch {
      return false
    }
  })
  if (wall) return wall

  const esHome = pages.find((p) => {
    try {
      const url = p.url().toLowerCase()
      return (
        url.includes("es.wallapop.com") &&
        !url.includes("/login") &&
        !url.includes("/auth/onboarding") &&
        !url.includes("accounts.wallapop.com")
      )
    } catch {
      return false
    }
  })
  return esHome ?? fallback
}

export type ReconcileBrowserState = "REQUIRES_2FA" | "ACTIVE" | "NONE"

/**
 * After a CDP handle exists: pick MFA/logged-in page and classify.
 * If no Wallapop tab (New Tab etc.), navigate to /wall first so cookies/session can be detected.
 * On NONE closes the browser handle (same as prior reconcile).
 */
function findMfaPage(pages: Page[]): Page | null {
  return (
    pages.find((p) => {
      const url = p.url().toLowerCase()
      return (
        url.includes("accounts.wallapop.com") || url.includes("login-actions")
      )
    }) ?? null
  )
}

function pageUrlLower(page: Page): string {
  try {
    return page.url().toLowerCase()
  } catch {
    return ""
  }
}

async function probeWallIfNeeded(
  mfaPage: Page | null,
  activePage: Page,
): Promise<Page> {
  const activeUrl = pageUrlLower(activePage)
  const onWallapop =
    activeUrl.includes("wallapop.com") || activeUrl.includes("login-actions")
  if (mfaPage || onWallapop) return activePage
  log("info", "wallapop_browser_reconcile_probe_nav", {
    from: activeUrl || "(unknown)",
    to: PROBE_URL,
  })
  await activePage.goto(PROBE_URL, {
    waitUntil: "domcontentloaded",
    timeout: NAV_TIMEOUT_MS,
  })
  return getWallapopHandle()?.page ?? activePage
}

async function classifyReconcilePage(
  activePage: Page,
): Promise<ReconcileBrowserState> {
  if (await detect2FA(activePage)) {
    log("info", "wallapop_browser_reconcile_mfa", { url: activePage.url() })
    return "REQUIRES_2FA"
  }
  if (await detectLoggedIn(activePage)) {
    log("info", "wallapop_browser_reconcile_active", {
      url: activePage.url(),
    })
    return "ACTIVE"
  }
  await closeWallapopBrowser()
  return "NONE"
}

async function detectReconcileStateFromHandle(): Promise<ReconcileBrowserState> {
  const handle = getWallapopHandle()
  if (!handle) return "NONE"
  const mfaPage = findMfaPage(handle.context.pages())
  let activePage = mfaPage ?? handle.page
  if (mfaPage && mfaPage !== handle.page) {
    setWallapopHandle({ ...handle, page: mfaPage, ownedPage: false })
  }
  activePage = await probeWallIfNeeded(mfaPage, activePage)
  if (!mfaPage) {
    await dismissWallapopConsent(activePage)
  }
  return classifyReconcilePage(activePage)
}

async function reconcileWithAttach(
  spawnIfNeeded: boolean,
): Promise<ReconcileBrowserState> {
  const busy = getBrowserBusy()
  if (busy !== "idle" && busy !== "rehydrate") {
    log("info", "wallapop_browser_reconcile_skipped_busy", {
      busy,
      spawnIfNeeded,
    })
    return "NONE"
  }

  try {
    let handle = getWallapopHandle()
    if (!handle) {
      handle = spawnIfNeeded
        ? await attachOrLaunch()
        : await connectCdpHandle()
      setWallapopHandle(handle)
      log("info", "wallapop_browser_reconcile_attached", {
        cdpUrl: CDP_URL,
        spawned: spawnIfNeeded,
      })
    }
    return await detectReconcileStateFromHandle()
  } catch (error) {
    log("info", "wallapop_browser_reconcile_none", {
      message: error instanceof Error ? error.message : String(error),
      spawnIfNeeded,
    })
    setWallapopHandle(null)
    return "NONE"
  }
}

/** Attach-only (no Chrome spawn). Used by status / publish gates. */
export async function reconcileWallapopBrowserState(): Promise<ReconcileBrowserState> {
  return reconcileWithAttach(false)
}

/**
 * Boot rehydrate: attach or spawn Chrome on CDP, then classify session.
 * Do not use on every status poll — would relaunch Chrome when disconnected.
 */
export async function reconcileWallapopBrowserStateSpawning(): Promise<ReconcileBrowserState> {
  return reconcileWithAttach(true)
}

async function requireIdleFor2fa(): Promise<void> {
  const busyAtStart = getBrowserBusy()
  if (busyAtStart !== "idle") {
    throw new BrowserBusyError(busyAtStart, "login")
  }
}

async function attachHandleFor2fa(): Promise<void> {
  let handle = getWallapopHandle()
  if (handle?.page) return
  const reconciled = await reconcileWallapopBrowserState()
  handle = getWallapopHandle()
  if (reconciled === "REQUIRES_2FA" && handle?.page) return
  const busyAfter = getBrowserBusy()
  if (busyAfter !== "idle") {
    throw new BrowserBusyError(busyAfter, "login")
  }
  throw new Error("No hay una sesión de autenticación activa.")
}

function assertLoginOutcome(outcome: BrowserLoginOutcome | "FAILED") {
  if (outcome === "FAILED") {
    throw new Error("No se pudo verificar el código 2FA.")
  }
  if (outcome === "REQUIRES_2FA") {
    throw new Error("Código 2FA incorrecto o aún pendiente.")
  }
  return outcome
}

async function fillWallapopOtp(page: Page, trimmed: string) {
  const otpInput = await firstVisible(page, SELECTORS.otp, 10_000)
  if (!otpInput) {
    throw new Error(
      "No se encontró el campo del código 2FA (data-input-otp / mfa_code).",
    )
  }
  await otpInput.fill(trimmed)
  try {
    const hidden = page.locator('input[name="mfa_code"]').first()
    if (await hidden.isVisible({ timeout: 800 }).catch(() => false)) {
      await hidden.fill(trimmed, { timeout: 1_500 }).catch(() => {})
    }
  } catch {
    // page may have navigated away already
  }
  return otpInput
}

async function submitWallapopOtp(
  page: Page,
  otpInput: Awaited<ReturnType<typeof firstVisible>>,
) {
  try {
    const submit = await firstVisible(page, SELECTORS.otpSubmit, 5_000)
    if (submit) {
      await submit.click({ timeout: 5_000 })
    } else if (otpInput) {
      await otpInput.press("Enter")
    }
  } catch {
    // Navigation during click is fine — fall through to outcome.
  }
}

async function retargetAfter2faSubmit(page: Page): Promise<Page> {
  const handle = getWallapopHandle()
  if (!handle) return page
  const next = preferLoggedInPage(handle.context.pages(), handle.page)
  setWallapopHandle({ ...handle, page: next, ownedPage: false })
  return next
}

async function runWallapop2faSubmit(code: string): Promise<BrowserLoginOutcome> {
  const handle = getWallapopHandle()
  if (!handle?.page) {
    throw new Error("No hay una sesión de autenticación activa.")
  }
  let page = handle.page
  if (!(await detect2FA(page))) {
    throw new Error(
      "La pantalla 2FA ya no está disponible. Reintenta el login.",
    )
  }
  const otpInput = await fillWallapopOtp(page, code.trim())
  if (!(await detect2FA(page))) {
    return assertLoginOutcome(await waitForLoginOutcome(page))
  }
  await submitWallapopOtp(page, otpInput)
  page = await retargetAfter2faSubmit(page)
  return assertLoginOutcome(await waitForLoginOutcome(page))
}

export async function submitWallapop2faInBrowser(
  code: string,
): Promise<BrowserLoginOutcome> {
  // Reconcile/attach while idle — reconcile skips when busy ≠ idle.
  await requireIdleFor2fa()
  await attachHandleFor2fa()
  return runWithBrowserBusy("login", () => runWallapop2faSubmit(code))
}
