/**
 * Chrome CDP attach / page helpers.
 */
import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright"

import { log } from "../log"

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

export function getWallapopHandle(): WallapopBrowserHandle | null {
  return handle
}

export function setWallapopHandle(next: WallapopBrowserHandle | null): void {
  handle = next
}

export function isClosedPage(page: { isClosed(): boolean }): boolean {
  try {
    return page.isClosed()
  } catch {
    return true
  }
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

export function killSpawnedChrome(): void {
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

export function hasOpenWallapopBrowser(): boolean {
  return handle != null
}

async function connectOverCdp(cdpUrl: string) {
  const versionUrl = `${cdpUrl.replace(/\/$/, "")}/json/version`
  try {
    const response = await fetch(versionUrl, {
      signal: AbortSignal.timeout(3_000),
    })
    if (response.ok) {
      const json = (await response.json()) as { webSocketDebuggerUrl?: string }
      if (json.webSocketDebuggerUrl) {
        const http = new URL(cdpUrl)
        const ws = new URL(json.webSocketDebuggerUrl)
        ws.hostname = http.hostname
        ws.port = http.port
        return chromium.connectOverCDP(ws.toString())
      }
    }
  } catch {
    // fall through to browserURL
  }
  return chromium.connectOverCDP(cdpUrl)
}

export async function connectCdpHandle(): Promise<WallapopBrowserHandle> {
  const browser = await connectOverCdp(CDP_URL)
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
async function resetStaleCdpHandle(): Promise<void> {
  if (!handle) return
  const connected = await isCdpConnected(handle)
  if (!connected) {
    log("warn", "wallapop_cdp_stale_handle_reset", { cdpUrl: CDP_URL })
    handle = null
    return
  }
  if (isClosedPage(handle.page)) {
    log("warn", "wallapop_cdp_closed_page_ignored", { cdpUrl: CDP_URL })
  }
}

async function attachCdpHandleOrThrow(): Promise<void> {
  if (handle) return
  try {
    handle = await attachOrLaunch()
    log("info", "wallapop_cdp_ensure_attached", { cdpUrl: CDP_URL })
  } catch (error) {
    throw new Error(cdpUnavailableMessage(error))
  }
}

async function reopenCdpIfPagesFail(): Promise<void> {
  if (!handle) return
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
}

async function openOwnedUploadTab(): Promise<Page> {
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

export async function ensureWallapopPage(): Promise<Page> {
  await resetStaleCdpHandle()
  await attachCdpHandleOrThrow()
  await reopenCdpIfPagesFail()
  return openOwnedUploadTab()
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
