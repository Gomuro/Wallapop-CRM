/**
 * Chrome CDP attach / page helpers.
 */
import {
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright"

import { parseChromeProxy } from "../../../../lib/accounts/chrome-proxy"
import { writeChromeProxyForPort } from "../account-chrome-proxy"
import {
  chromeProxyForPort,
  hydrateChromeProxyFromAccount,
  killSpawnedChrome,
  rememberChromeProxy,
  spawnRealChrome,
} from "./chrome"
import { hasLocalProxy } from "./local-proxy"

export { killSpawnedChrome }

import { log } from "../log"
import { ATTACH_LIMIT_MS, oneAttachAtATime } from "./attach-queue"
import { waitForChromeQuit } from "./busy"
import {
  CDP_PORT,
  cdpUrlForPort,
  connectOverCdp,
  isCdpListening,
  quitListeningChrome,
  waitForCdp,
} from "./cdp-connect"

export { CDP_PORT }
export const CDP_URL =
  process.env.WALLAPOP_CDP_URL ?? `http://127.0.0.1:${CDP_PORT}`
export const NAV_TIMEOUT_MS = 45_000
export const ACTION_TIMEOUT_MS = 20_000
export const WALLAPOP_WALL_URL = "https://es.wallapop.com/wall"

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

export function hasOpenWallapopBrowser(port = CDP_PORT): boolean {
  return handles.has(port)
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

export function attachOrLaunch(
  proxyInput?: string | null,
  port = CDP_PORT,
): Promise<WallapopBrowserHandle> {
  return oneAttachAtATime(
    port,
    () => attachOrLaunchNow(proxyInput, port),
    ATTACH_LIMIT_MS,
  )
}

async function attachOrLaunchNow(
  proxyInput: string | null | undefined,
  port: number,
): Promise<WallapopBrowserHandle> {
  if (parseChromeProxy(proxyInput ?? null)) {
    rememberChromeProxy(port, proxyInput)
    await writeChromeProxyForPort(port, proxyInput)
  } else {
    await hydrateChromeProxyFromAccount(port)
  }
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

  await spawnRealChrome(undefined, port)
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
    setWallapopHandle(await attachOrLaunchNow(undefined, port), port)
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
      setWallapopHandle(await attachOrLaunchNow(undefined, port), port)
    } catch (reconnectError) {
      throw new Error(cdpUnavailableMessage(reconnectError, port))
    }
  }
}

/**
 * Attach (or spawn) Chrome CDP. Shared by publish/sold worker windows
 * and login. Does not open a job tab/window.
 */
export function ensureCdpAttached(
  port = CDP_PORT,
  limitMs = ATTACH_LIMIT_MS,
): Promise<WallapopBrowserHandle> {
  return oneAttachAtATime(port, () => ensureCdpAttachedNow(port), limitMs)
}

async function ensureCdpAttachedNow(port: number): Promise<WallapopBrowserHandle> {
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
