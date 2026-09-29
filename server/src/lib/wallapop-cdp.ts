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
  /** True if we opened a new tab; false if we reused an existing Chrome tab. */
  ownedPage: boolean
}

let handle: WallapopBrowserHandle | null = null
/** Chrome process we spawned; left running after disconnect (profile stays warm). */
let chromeProcess: ChildProcess | null = null

export type BrowserBusy = "idle" | "publish" | "login" | "logout" | "rehydrate"

let browserBusy: BrowserBusy = "idle"

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
  browserBusy = op
  try {
    return await fn()
  } finally {
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

export async function firstVisible(
  page: Page,
  selectors: readonly string[],
  timeoutMs = 5_000,
): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
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

/**
 * Disconnect Playwright from Chrome.
 * Does NOT quit Chrome — so the profile (and a later re-attach) stay available.
 * Blocked while publish holds the busy lock.
 */
export async function closeWallapopBrowser(): Promise<void> {
  if (browserBusy === "publish") {
    throw new BrowserBusyError("publish", "logout")
  }
  const current = handle
  handle = null
  if (!current) return
  try {
    if (current.ownedPage) {
      await current.page.close().catch(() => {})
    }
    await current.browser.close()
  } catch (error) {
    log("warn", "wallapop_browser_close_failed", {
      message: error instanceof Error ? error.message : String(error),
    })
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

/** Prefer a real Wallapop tab (not ads iframe / dead chrome-error). */
async function pickUsableWallapopPage(pages: Page[]): Promise<Page | null> {
  for (const p of pages) {
    try {
      const meta = (await p.evaluate(
        `({ h: location.href, w: innerWidth })`,
      )) as { h: string; w: number }
      if (
        typeof meta.h === "string" &&
        meta.h.includes("es.wallapop.com") &&
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
 * Page for publish / dry-run. Reuses cached CDP handle when alive.
 * If Chrome is not listening on CDP, spawns Chrome (same as login / boot rehydrate).
 * Does not call closeWallapopBrowser on success — see API.md «Chrome lifecycle».
 */
export async function ensureWallapopPage(): Promise<Page> {
  if (handle) {
    const alive = await isHandleAlive(handle)
    if (!alive) {
      log("warn", "wallapop_cdp_stale_handle_reset", { cdpUrl: CDP_URL })
      handle = null
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

  let pages: Page[]
  try {
    pages = handle.context.pages()
  } catch (error) {
    log("warn", "wallapop_cdp_pages_failed_reconnect", {
      message: error instanceof Error ? error.message : String(error),
    })
    handle = null
    try {
      handle = await attachOrLaunch()
      pages = handle.context.pages()
    } catch (reconnectError) {
      throw new Error(cdpUnavailableMessage(reconnectError))
    }
  }

  const usable = await pickUsableWallapopPage(pages)
  if (usable) {
    handle = { ...handle, page: usable, ownedPage: false }
    await usable.bringToFront().catch(() => {})
    return usable
  }

  const page = await handle.context.newPage()
  page.setDefaultTimeout(ACTION_TIMEOUT_MS)
  handle = { ...handle, page, ownedPage: true }
  return page
}

async function isHandleAlive(current: WallapopBrowserHandle): Promise<boolean> {
  try {
    if (!current.browser.isConnected()) return false
    current.context.pages()
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
