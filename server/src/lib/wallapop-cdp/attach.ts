/**
 * Chrome CDP attach / page helpers.
 */
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright"

import {
  chromeProxyForPort,
  killSpawnedChrome,
  rememberChromeProxy,
  spawnRealChrome,
} from "./chrome"
import { hasLocalProxy } from "./local-proxy"

export { killSpawnedChrome }

import { firstCdpPort } from "../../../../lib/accounts/chrome-place"
import { log } from "../log"
import { promiseWithin, waitForChromeQuit } from "./busy"

const CDP_CONNECT_TIMEOUT_MS = 15_000

export const CDP_PORT = firstCdpPort()
export const CDP_URL =
  process.env.WALLAPOP_CDP_URL ?? `http://127.0.0.1:${CDP_PORT}`
export const NAV_TIMEOUT_MS = 45_000
export const ACTION_TIMEOUT_MS = 20_000
export const WALLAPOP_WALL_URL = "https://es.wallapop.com/wall"
const CDP_READY_TIMEOUT_MS = 30_000

function cdpUrlForPort(port: number): string {
  if (port === CDP_PORT && process.env.WALLAPOP_CDP_URL?.trim()) {
    return process.env.WALLAPOP_CDP_URL.trim()
  }
  return `http://127.0.0.1:${port}`
}

/** Every account's Chrome uses this window. Profiles otherwise restore different sizes. */
export const ACCOUNT_WINDOW_WIDTH = 1440
export const ACCOUNT_WINDOW_HEIGHT = 900

export type WallapopBrowserHandle = {
  browser: Browser
  context: BrowserContext
  page: Page
  /** True if we opened a new tab for this handle (publish upload); false if we reused `/wall` or another existing tab. */
  ownedPage: boolean
}

const handles = new Map<number, WallapopBrowserHandle>()

function resolveCdpPort(port?: number): number {
  return port ?? CDP_PORT
}

export function getWallapopHandle(port?: number): WallapopBrowserHandle | null {
  return handles.get(resolveCdpPort(port)) ?? null
}

export function setWallapopHandle(
  next: WallapopBrowserHandle | null,
  port?: number,
): void {
  const key = resolveCdpPort(port)
  if (next) handles.set(key, next)
  else handles.delete(key)
}

export function isClosedPage(page: { isClosed(): boolean }): boolean {
  try {
    return page.isClosed()
  } catch {
    return true
  }
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

export function hasOpenWallapopBrowser(port = CDP_PORT): boolean {
  return handles.has(port)
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
        return await promiseWithin(
          chromium.connectOverCDP(ws.toString()),
          CDP_CONNECT_TIMEOUT_MS,
          "CDP websocket",
        )
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("timed out")) throw error
  }
  return promiseWithin(
    chromium.connectOverCDP(cdpUrl),
    CDP_CONNECT_TIMEOUT_MS,
    "CDP",
  )
}

export async function connectCdpHandle(port = CDP_PORT): Promise<WallapopBrowserHandle> {
  const browser = await connectOverCdp(cdpUrlForPort(port))
  const context = browser.contexts()[0] ?? (await browser.newContext())
  const pages = context.pages().filter((p) => {
    try {
      return !p.isClosed() && p.url() !== ""
    } catch {
      return false
    }
  })
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

async function isCdpListening(cdpUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${cdpUrl.replace(/\/$/, "")}/json/version`, {
      signal: AbortSignal.timeout(1_200),
    })
    return response.ok
  } catch {
    return false
  }
}

async function quitListeningChrome(port: number): Promise<void> {
  const cdpUrl = cdpUrlForPort(port)
  if (await isCdpListening(cdpUrl)) {
    try {
      const browser = await connectOverCdp(cdpUrl)
      try {
        const session = await browser.newBrowserCDPSession()
        await session.send("Browser.close")
      } catch {
        await browser.close().catch(() => {})
      }
    } catch {
      // already down
    }
  }
  await killSpawnedChrome(port)
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (!(await isCdpListening(cdpUrl))) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

/**
 * 1) Attach to Chrome already listening on CDP.
 * 2) If closed — start real Google Chrome, then attach.
 * Auth proxy: never reuse a Chrome started without the local forwarder.
 */
async function reuseAuthedChrome(
  port: number,
  cdpUrl: string,
  upstream: string | null,
): Promise<WallapopBrowserHandle | null> {
  if ((await isCdpListening(cdpUrl)) && hasLocalProxy(port)) {
    const attached = await connectCdpHandle(port)
    log("info", "wallapop_browser_attached_cdp", { cdpUrl, proxyUpstream: upstream })
    return attached
  }
  log("info", "wallapop_chrome_relaunch_for_proxy", { cdpUrl, proxyUpstream: upstream })
  await quitListeningChrome(port)
  return null
}

export async function attachOrLaunch(
  proxyInput?: string | null,
  port = CDP_PORT,
): Promise<WallapopBrowserHandle> {
  if (proxyInput !== undefined) rememberChromeProxy(port, proxyInput)
  const cdpUrl = cdpUrlForPort(port)
  const stored = chromeProxyForPort(port)
  if (stored?.username) {
    const reused = await reuseAuthedChrome(port, cdpUrl, stored.server ?? null)
    if (reused) return reused
  } else {
    try {
      const attached = await connectCdpHandle(port)
      log("info", "wallapop_browser_attached_cdp", { cdpUrl })
      return attached
    } catch (error) {
      log("info", "wallapop_cdp_not_ready_launching_chrome", {
        cdpUrl,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  await spawnRealChrome(proxyInput, port)
  await waitForCdp(cdpUrl)
  const attached = await connectCdpHandle(port)
  log("info", "wallapop_browser_attached_after_spawn", {
    cdpUrl,
    proxyUpstream: stored?.server ?? null,
  })
  return attached
}

function cdpUnavailableMessage(cause: unknown, port = CDP_PORT): string {
  const detail = cause instanceof Error ? cause.message : String(cause)
  return `Chrome CDP no disponible (${cdpUrlForPort(port)}). Comprueba que Google Chrome esté instalado o conecta la cuenta Wallapop. ${detail}`
}

async function resetStaleCdpHandle(port = CDP_PORT): Promise<void> {
  const handle = getWallapopHandle(port)
  if (!handle) return
  const connected = await isCdpConnected(handle)
  if (!connected) {
    log("warn", "wallapop_cdp_stale_handle_reset", { cdpUrl: cdpUrlForPort(port) })
    setWallapopHandle(null, port)
    return
  }
  if (isClosedPage(handle.page)) {
    log("warn", "wallapop_cdp_closed_page_ignored", { cdpUrl: cdpUrlForPort(port) })
  }
}

async function attachCdpHandleOrThrow(port = CDP_PORT): Promise<void> {
  if (getWallapopHandle(port)) return
  try {
    setWallapopHandle(await attachOrLaunch(undefined, port), port)
    log("info", "wallapop_cdp_ensure_attached", { cdpUrl: cdpUrlForPort(port) })
  } catch (error) {
    throw new Error(cdpUnavailableMessage(error, port))
  }
}

async function reopenCdpIfPagesFail(port = CDP_PORT): Promise<void> {
  const handle = getWallapopHandle(port)
  if (!handle) return
  try {
    handle.context.pages()
  } catch (error) {
    log("warn", "wallapop_cdp_pages_failed_reconnect", {
      message: error instanceof Error ? error.message : String(error),
    })
    setWallapopHandle(null, port)
    try {
      setWallapopHandle(await attachOrLaunch(undefined, port), port)
    } catch (reconnectError) {
      throw new Error(cdpUnavailableMessage(reconnectError, port))
    }
  }
}

/**
 * Attach (or spawn) Chrome CDP. Shared by publish/sold worker windows
 * and login. Does not open a job tab/window.
 */
export async function ensureCdpAttached(port = CDP_PORT): Promise<WallapopBrowserHandle> {
  await waitForChromeQuit(port)
  await resetStaleCdpHandle(port)
  await attachCdpHandleOrThrow(port)
  await reopenCdpIfPagesFail(port)
  const handle = getWallapopHandle(port)
  if (!handle) {
    throw new Error(cdpUnavailableMessage(new Error("CDP handle missing"), port))
  }
  return handle
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
