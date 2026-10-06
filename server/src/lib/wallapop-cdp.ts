/**
 * Shared Chrome CDP attach / page helpers.
 * Login: wallapop-browser.ts. Publish: wallapop-publish.ts.
 */
import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright"

import { log } from "./log"

export const CDP_URL = process.env.WALLAPOP_CDP_URL ?? "http://127.0.0.1:9222"
export const CDP_PORT = Number(process.env.WALLAPOP_CDP_PORT ?? "9222")
export const NAV_TIMEOUT_MS = 45_000
export const ACTION_TIMEOUT_MS = 20_000
export const WALLAPOP_WALL_URL = "https://es.wallapop.com/wall"
const CDP_READY_TIMEOUT_MS = 30_000

const PROFILE_DIR =
  process.env.WALLAPOP_CHROME_USER_DATA_DIR?.trim() ||
  path.resolve(process.env.USERPROFILE ?? "", "ChromeCDP-Persistent")

const CHROME_LAUNCH_EXTRA_ARGS = [
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-features=CalculateNativeWinOcclusion",
  "--no-first-run",
  "--no-default-browser-check",
] as const

export type WallapopBrowserHandle = {
  browser: Browser
  context: BrowserContext
  page: Page
  /** True if we opened a new tab for this handle (publish upload); false if we reused `/wall` or another existing tab. */
  ownedPage: boolean
}

let handle: WallapopBrowserHandle | null = null
/** Chrome process we spawned; left running after disconnect (profile stays warm). */
let chromeProcess: ChildProcess | null = null

export type BrowserBusy = "idle" | "publish" | "login" | "logout" | "rehydrate"

let browserBusy: BrowserBusy = "idle"
/** AbortController for the in-flight publish tick; null when not publishing. */
let publishAbort: AbortController | null = null
/** Set by Stop: skip quitWallapopChrome so the session stays warm for next Start. */
let keepChromeAfterAbort = false

export class BrowserBusyError extends Error {
  readonly code = "BROWSER_BUSY" as const
  readonly busyWith: BrowserBusy
  constructor(busyWith: BrowserBusy, attempted: BrowserBusy) {
    super(
      `Chrome ocupado con «${busyWith}»; no se puede iniciar «${attempted}». Espera a que termine.`,
    )
    this.name = "BrowserBusyError"
    this.busyWith = busyWith
  }
}

export function isBrowserBusyError(error: unknown): error is BrowserBusyError {
  return error instanceof BrowserBusyError
}

export class PublishAbortedError extends Error {
  readonly code = "PUBLISH_ABORTED" as const
  constructor() {
    super("Publicación abortada (autopost detenido).")
    this.name = "PublishAbortedError"
  }
}

export function isPublishAbortedError(
  error: unknown,
): error is PublishAbortedError {
  return error instanceof PublishAbortedError
}

export function isInFlightPublishAborted(): boolean {
  return publishAbort?.signal.aborted === true
}

export function throwIfPublishAborted(): void {
  if (isInFlightPublishAborted()) throw new PublishAbortedError()
}

/**
 * Stop the current publish tick: abort CDP waits and close the owned upload tab.
 * Does not quit chrome.exe — the `/wall` session stays for the next Start.
 */
export async function abortInFlightPublish(): Promise<void> {
  if (browserBusy !== "publish") {
    log("info", "wallapop_publish_abort_idle", { busy: browserBusy })
    return
  }
  keepChromeAfterAbort = true
  publishAbort?.abort()
  log("info", "wallapop_publish_abort_requested")
  await closeWallapopUploadTab()
}

export function consumeKeepChromeAfterAbort(): boolean {
  const keep = keepChromeAfterAbort
  keepChromeAfterAbort = false
  return keep
}

/** Tests only — drop abort / busy flags. Does not touch the CDP handle. */
export function resetWallapopPublishAbortForTests(): void {
  publishAbort = null
  keepChromeAfterAbort = false
  browserBusy = "idle"
}

export function getBrowserBusy(): BrowserBusy {
  return browserBusy
}

/** True when a publish run holds the Chrome lock. */
export function isBrowserPublishBusy(): boolean {
  return browserBusy === "publish"
}

/**
 * Reject if any op holds the lock (single-owner; no same-op re-entry).
 * Nested closeWallapopBrowser during login/logout is allowed separately.
 */
export function assertBrowserIdle(forOp: Exclude<BrowserBusy, "idle">): void {
  if (browserBusy === "idle") return
  throw new BrowserBusyError(browserBusy, forOp)
}

export async function runWithBrowserBusy<T>(
  op: Exclude<BrowserBusy, "idle">,
  fn: () => Promise<T>,
): Promise<T> {
  assertBrowserIdle(op)
  if (op === "publish") publishAbort = new AbortController()
  browserBusy = op
  try {
    return await fn()
  } finally {
    if (op === "publish") publishAbort = null
    browserBusy = "idle"
  }
}

export function getWallapopHandle(): WallapopBrowserHandle | null {
  return handle
}

export function setWallapopHandle(next: WallapopBrowserHandle | null): void {
  handle = next
}

function findChromeExecutable(): string {
  const fromEnv = process.env.WALLAPOP_CHROME_PATH?.trim()
  const candidates = [
    fromEnv,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA
      ? path.join(
          process.env.LOCALAPPDATA,
          "Google",
          "Chrome",
          "Application",
          "chrome.exe",
        )
      : null,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  throw new Error(
    "No se encontró Google Chrome. Instálalo o define WALLAPOP_CHROME_PATH.",
  )
}

async function waitForCdp(cdpUrl: string, timeoutMs = CDP_READY_TIMEOUT_MS) {
  const versionUrl = `${cdpUrl.replace(/\/$/, "")}/json/version`
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(versionUrl, {
        signal: AbortSignal.timeout(1_500),
      })
      if (response.ok) return
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(
    `Chrome CDP no respondió en ${cdpUrl}. ¿Arrancó Chrome con --remote-debugging-port=${CDP_PORT}?`,
  )
}

function spawnRealChrome(proxy?: string | null): ChildProcess {
  const chromePath = findChromeExecutable()
  fs.mkdirSync(PROFILE_DIR, { recursive: true })

  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    ...CHROME_LAUNCH_EXTRA_ARGS,
  ]
  const proxyServer = proxy?.trim()
  if (proxyServer) {
    args.push(`--proxy-server=${proxyServer}`)
  }

  log("info", "wallapop_chrome_spawning", {
    chromePath,
    profileDir: PROFILE_DIR,
    cdpPort: CDP_PORT,
  })

  const child = spawn(chromePath, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  })
  child.unref()
  chromeProcess = child
  return child
}

function killSpawnedChrome(): void {
  const child = chromeProcess
  chromeProcess = null
  if (child?.pid == null) return
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      })
    } else {
      try {
        process.kill(child.pid, "SIGTERM")
      } catch {
        child.kill("SIGTERM")
      }
    }
    log("info", "wallapop_chrome_process_killed", { pid: child.pid })
  } catch (error) {
    log("warn", "wallapop_chrome_process_kill_failed", {
      pid: child.pid,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

async function sendCdpBrowserClose(browser: Browser): Promise<void> {
  const withCdp = browser as Browser & {
    newBrowserCDPSession?: () => Promise<{
      send: (method: string) => Promise<unknown>
    }>
  }
  if (typeof withCdp.newBrowserCDPSession === "function") {
    const session = await withCdp.newBrowserCDPSession()
    await session.send("Browser.close")
    return
  }
  await browser.close()
}

/**
 * Disconnect CDP and quit chrome.exe. Persistent user-data-dir stays on disk
 * so the next attachOrLaunch restores cookies. Use after publish so the VPS
 * is not holding a headed Chrome between ticks.
 */
export async function quitWallapopChrome(): Promise<void> {
  const current = handle
  handle = null
  if (current) {
    try {
      await sendCdpBrowserClose(current.browser)
    } catch (error) {
      log("warn", "wallapop_chrome_cdp_quit_failed", {
        message: error instanceof Error ? error.message : String(error),
      })
      await current.browser.close().catch(() => {})
    }
  }
  killSpawnedChrome()
}

export async function firstVisible(
  page: Page,
  selectors: readonly string[],
  timeoutMs = 5_000,
): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    throwIfPublishAborted()
    for (const selector of selectors) {
      const locator = page.locator(selector).first()
      try {
        if (await locator.isVisible({ timeout: 400 })) {
          return locator
        }
      } catch {
        // try next
      }
    }
    await page.waitForTimeout(250)
  }
  return null
}

/** ConsentManager (CMP). Keep in sync with API.md «cookieAccept». */
export const WALLAPOP_CMP_ACCEPT_SELECTORS = [
  "#cmpwelcomebtnyes a.cmpboxbtnyes",
  "#cmpwelcomebtnyes a",
  "a.cmpboxbtnyes",
  "#cmpbntyestxt",
  'a.cmpboxbtn:has-text("Accept all")',
  'a.cmpboxbtn:has-text("Aceptar todo")',
  'a.cmpboxbtn:has-text("Aceptar todas")',
  'button:has-text("Aceptar todas")',
  'button:has-text("Accept all")',
  'button:has-text("Aceptar")',
  'button:has-text("Accept")',
  "#onetrust-accept-btn-handler",
] as const

/** Dismiss GDPR cookie banner so login / publish / session probe can interact with the page. */
export async function dismissWallapopConsent(page: Page): Promise<void> {
  const btn = await firstVisible(page, WALLAPOP_CMP_ACCEPT_SELECTORS, 5_000)
  if (!btn) return
  try {
    await btn.click({ timeout: 3_000 })
    await page
      .locator("#cmpbox")
      .waitFor({ state: "hidden", timeout: 5_000 })
      .catch(() => {})
  } catch {
    // ignore
  }
}

/**
 * Disconnect Playwright, quit chrome.exe, keep the Persistent profile on disk.
 * Blocked while publish holds the busy lock (use `quitWallapopChrome` after the lock).
 */
export async function closeWallapopBrowser(): Promise<void> {
  if (browserBusy === "publish") {
    throw new BrowserBusyError("publish", "logout")
  }
  await quitWallapopChrome()
}

export function isLoginOr2faUrl(url: string): boolean {
  const lower = url.toLowerCase()
  return (
    lower.includes("accounts.wallapop.com") || lower.includes("login-actions")
  )
}

export function isWallFeedUrl(url: string): boolean {
  const lower = url.toLowerCase()
  if (!lower.includes("es.wallapop.com")) return false
  return /\/wall(\/|\?|#|$)/.test(lower)
}

export type PageUrlSnapshot = {
  url: string
  isClosed: boolean
}

/** Close the upload tab only when we opened it and it is not login/2FA. */
export function shouldCloseUploadTab(ownedPage: boolean, url: string): boolean {
  return ownedPage && !isLoginOr2faUrl(url)
}

export function isClosedPage(page: { isClosed(): boolean }): boolean {
  try {
    return page.isClosed()
  } catch {
    return true
  }
}

/** Prefer `/wall`, then any live es.wallapop.com tab. Never login/2FA. */
export function pickLiveSessionPage<T extends PageUrlSnapshot>(
  pages: T[],
): T | null {
  const live = pages.filter((p) => !p.isClosed && !isLoginOr2faUrl(p.url))
  const wall = live.find((p) => isWallFeedUrl(p.url))
  if (wall) return wall
  return live.find((p) => p.url.toLowerCase().includes("es.wallapop.com")) ?? null
}

function snapshotOpenPages(pages: Page[]): Array<PageUrlSnapshot & { page: Page }> {
  const snaps: Array<PageUrlSnapshot & { page: Page }> = []
  for (const page of pages) {
    if (isClosedPage(page)) continue
    try {
      snaps.push({ page, url: page.url(), isClosed: false })
    } catch {
      // inaccessible
    }
  }
  return snaps
}

/**
 * Point `handle.page` at a remaining live Wallapop tab (prefer `/wall`).
 * If none, open `/wall` in a new tab. Never leave a closed Page on the handle.
 * Does not disconnect CDP and does not quit chrome.exe.
 */
async function retargetHandleAfterUploadClose(
  current: WallapopBrowserHandle,
): Promise<void> {
  let remaining: Page[] = []
  try {
    remaining = current.context.pages().filter((p) => !isClosedPage(p))
  } catch (error) {
    log("warn", "wallapop_upload_tab_retarget_pages_failed", {
      message: error instanceof Error ? error.message : String(error),
    })
    handle = null
    return
  }

  const urlPick = pickLiveSessionPage(snapshotOpenPages(remaining))
  const wall = urlPick && isWallFeedUrl(urlPick.url) ? urlPick.page : null
  const next =
    wall ?? (await pickUsableWallapopPage(remaining)) ?? urlPick?.page ?? null

  if (next) {
    next.setDefaultTimeout(ACTION_TIMEOUT_MS)
    handle = { ...current, page: next, ownedPage: false }
    await next.bringToFront().catch(() => {})
    let nextUrl = ""
    try {
      nextUrl = next.url()
    } catch {
      nextUrl = urlPick?.url ?? ""
    }
    log("info", "wallapop_handle_retargeted", { url: nextUrl })
    return
  }

  try {
    const page = await current.context.newPage()
    page.setDefaultTimeout(ACTION_TIMEOUT_MS)
    try {
      await navigateViaAssign(page, WALLAPOP_WALL_URL, 1_500)
    } catch {
      // A live blank tab is still better than a closed Page.
    }
    handle = { ...current, page, ownedPage: false }
    log("info", "wallapop_handle_retargeted_new_wall")
  } catch (error) {
    log("warn", "wallapop_handle_retarget_new_page_failed", {
      message: error instanceof Error ? error.message : String(error),
    })
    handle = null
  }
}

/**
 * Close the owned upload tab used for this publish / dry-run (success or failure after attach).
 * Allowed during the publish busy lock. Does not disconnect Playwright and does not quit chrome.exe.
 * Never closes the session `/wall` tab (`ownedPage: false`) or login / 2FA tabs.
 */
export async function closeWallapopUploadTab(): Promise<void> {
  const current = handle
  if (!current) return

  try {
    let url = ""
    let alreadyClosed = isClosedPage(current.page)
    if (!alreadyClosed) {
      try {
        url = current.page.url()
      } catch {
        alreadyClosed = true
      }
    }

    if (alreadyClosed) {
      log("info", "wallapop_upload_tab_already_closed", {
        ownedPage: current.ownedPage,
      })
      await retargetHandleAfterUploadClose(current)
      return
    }

    if (!shouldCloseUploadTab(current.ownedPage, url)) {
      log(
        "info",
        current.ownedPage
          ? "wallapop_upload_tab_kept_login"
          : "wallapop_upload_tab_kept_unowned",
        { url, ownedPage: current.ownedPage },
      )
      return
    }

    await current.page.close()
    log("info", "wallapop_upload_tab_closed", {
      url,
      ownedPage: true,
    })
    await retargetHandleAfterUploadClose(current)
  } catch (error) {
    log("warn", "wallapop_upload_tab_close_failed", {
      message: error instanceof Error ? error.message : String(error),
    })
    try {
      await retargetHandleAfterUploadClose(current)
    } catch {
      if (isClosedPage(current.page)) handle = null
    }
  }
}

export function hasOpenWallapopBrowser(): boolean {
  return handle != null
}

export async function connectCdpHandle(): Promise<WallapopBrowserHandle> {
  const browser = await chromium.connectOverCDP(CDP_URL)
  const context = browser.contexts()[0] ?? (await browser.newContext())
  const pages = context.pages()
  const preferred =
    pages.find((p) => {
      const url = p.url().toLowerCase()
      return (
        url.includes("accounts.wallapop.com") || url.includes("login-actions")
      )
    }) ??
    pages.find((p) => p.url().toLowerCase().includes("wallapop.com")) ??
    pages[0]
  const ownedPage = !preferred
  const page = preferred ?? (await context.newPage())
  page.setDefaultTimeout(ACTION_TIMEOUT_MS)
  return { browser, context, page, ownedPage }
}

/**
 * 1) Attach to Chrome already listening on CDP.
 * 2) If closed — start real Google Chrome, then attach.
 */
export async function attachOrLaunch(
  proxyInput?: string | null,
): Promise<WallapopBrowserHandle> {
  try {
    const attached = await connectCdpHandle()
    log("info", "wallapop_browser_attached_cdp", { cdpUrl: CDP_URL })
    return attached
  } catch (error) {
    log("info", "wallapop_cdp_not_ready_launching_chrome", {
      cdpUrl: CDP_URL,
      message: error instanceof Error ? error.message : String(error),
    })
  }

  spawnRealChrome(proxyInput)
  await waitForCdp(CDP_URL)
  const attached = await connectCdpHandle()
  log("info", "wallapop_browser_attached_after_spawn", { cdpUrl: CDP_URL })
  return attached
}

/** Prefer a real Wallapop tab (not ads iframe / dead chrome-error / login). */
async function pickUsableWallapopPage(pages: Page[]): Promise<Page | null> {
  for (const p of pages) {
    try {
      if (isClosedPage(p)) continue
      if (isLoginOr2faUrl(p.url())) continue
      const meta = (await p.evaluate(
        `({ h: location.href, w: innerWidth })`,
      )) as { h: string; w: number }
      if (
        typeof meta.h === "string" &&
        meta.h.includes("es.wallapop.com") &&
        !isLoginOr2faUrl(meta.h) &&
        typeof meta.w === "number" &&
        meta.w > 100
      ) {
        return p
      }
    } catch {
      // closed / inaccessible
    }
  }
  return null
}

function cdpUnavailableMessage(cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause)
  return `Chrome CDP no disponible (${CDP_URL}). Comprueba que Google Chrome esté instalado o conecta la cuenta Wallapop. ${detail}`
}

/**
 * Page for publish / dry-run. Reuses cached CDP handle when the connection is alive.
 * Always opens a **new** tab (`ownedPage: true`) for the upload flow so `/wall` stays.
 * If Chrome is not listening on CDP, spawns Chrome (same as login / boot rehydrate).
 * After publish the API quits chrome.exe (`quitWallapopChrome`); next run spawn/attach again.
 */
export async function ensureWallapopPage(): Promise<Page> {
  if (handle) {
    const connected = await isCdpConnected(handle)
    if (!connected) {
      log("warn", "wallapop_cdp_stale_handle_reset", { cdpUrl: CDP_URL })
      handle = null
    } else if (isClosedPage(handle.page)) {
      log("warn", "wallapop_cdp_closed_page_ignored", { cdpUrl: CDP_URL })
    }
  }

  if (!handle) {
    try {
      handle = await attachOrLaunch()
      log("info", "wallapop_cdp_ensure_attached", { cdpUrl: CDP_URL })
    } catch (error) {
      throw new Error(cdpUnavailableMessage(error))
    }
  }

  try {
    handle.context.pages()
  } catch (error) {
    log("warn", "wallapop_cdp_pages_failed_reconnect", {
      message: error instanceof Error ? error.message : String(error),
    })
    handle = null
    try {
      handle = await attachOrLaunch()
    } catch (reconnectError) {
      throw new Error(cdpUnavailableMessage(reconnectError))
    }
  }

  if (!handle) {
    throw new Error(cdpUnavailableMessage(new Error("CDP handle missing")))
  }

  const page = await handle.context.newPage()
  page.setDefaultTimeout(ACTION_TIMEOUT_MS)
  await page.bringToFront().catch(() => {})
  handle = { ...handle, page, ownedPage: true }
  log("info", "wallapop_upload_tab_opened", { ownedPage: true })
  return page
}

async function isCdpConnected(current: WallapopBrowserHandle): Promise<boolean> {
  try {
    if (!current.browser.isConnected()) return false
    current.context.pages()
    return true
  } catch {
    return false
  }
}

export async function isHandleAlive(
  current: WallapopBrowserHandle,
): Promise<boolean> {
  try {
    if (!(await isCdpConnected(current))) return false
    if (isClosedPage(current.page)) return false
    return true
  } catch {
    return false
  }
}

/**
 * Navigate without page.goto on a live Wallapop tab (avoids ERR_BLOCKED_BY_RESPONSE).
 */
export async function navigateViaAssign(
  page: Page,
  url: string,
  settleMs = 4_000,
): Promise<void> {
  await page.evaluate(`location.assign(${JSON.stringify(url)})`)
  await page.waitForTimeout(settleMs)
}
