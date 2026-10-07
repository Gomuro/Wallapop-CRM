import type { Page } from "playwright"

import { log } from "../log"
import {
  ACTION_TIMEOUT_MS,
  getWallapopHandle,
  isClosedPage,
  killSpawnedChrome,
  navigateViaAssign,
  setWallapopHandle,
  WALLAPOP_WALL_URL,
  type WallapopBrowserHandle,
} from "./attach"
import { BrowserBusyError, getBrowserBusy } from "./busy"

async function sendCdpBrowserClose(
  browser: WallapopBrowserHandle["browser"],
): Promise<void> {
  const withCdp = browser as WallapopBrowserHandle["browser"] & {
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
  const current = getWallapopHandle()
  setWallapopHandle(null)
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

/**
 * Disconnect Playwright, quit chrome.exe, keep the Persistent profile on disk.
 * Blocked while publish holds the busy lock (use `quitWallapopChrome` after the lock).
 */
export async function closeWallapopBrowser(): Promise<void> {
  if (getBrowserBusy() === "publish") {
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

/** Prefer `/wall`, then any live es.wallapop.com tab. Never login/2FA. */
export function pickLiveSessionPage<T extends PageUrlSnapshot>(
  pages: T[],
): T | null {
  const live = pages.filter((p) => !p.isClosed && !isLoginOr2faUrl(p.url))
  const wall = live.find((p) => isWallFeedUrl(p.url))
  if (wall) return wall
  return live.find((p) => p.url.toLowerCase().includes("es.wallapop.com")) ?? null
}

function snapshotOpenPages(
  pages: Page[],
): Array<PageUrlSnapshot & { page: Page }> {
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

/**
 * Point `handle.page` at a remaining live Wallapop tab (prefer `/wall`).
 * If none, open `/wall` in a new tab. Never leave a closed Page on the handle.
 * Does not disconnect CDP and does not quit chrome.exe.
 */
async function retargetToExistingPage(
  current: WallapopBrowserHandle,
  remaining: Page[],
): Promise<boolean> {
  const urlPick = pickLiveSessionPage(snapshotOpenPages(remaining))
  const wall = urlPick && isWallFeedUrl(urlPick.url) ? urlPick.page : null
  const next =
    wall ?? (await pickUsableWallapopPage(remaining)) ?? urlPick?.page ?? null
  if (!next) return false
  next.setDefaultTimeout(ACTION_TIMEOUT_MS)
  setWallapopHandle({ ...current, page: next, ownedPage: false })
  await next.bringToFront().catch(() => {})
  let nextUrl = ""
  try {
    nextUrl = next.url()
  } catch {
    nextUrl = urlPick?.url ?? ""
  }
  log("info", "wallapop_handle_retargeted", { url: nextUrl })
  return true
}

async function retargetToNewWallPage(
  current: WallapopBrowserHandle,
): Promise<void> {
  try {
    const page = await current.context.newPage()
    page.setDefaultTimeout(ACTION_TIMEOUT_MS)
    try {
      await navigateViaAssign(page, WALLAPOP_WALL_URL, 1_500)
    } catch {
      // A live blank tab is still better than a closed Page.
    }
    setWallapopHandle({ ...current, page, ownedPage: false })
    log("info", "wallapop_handle_retargeted_new_wall")
  } catch (error) {
    log("warn", "wallapop_handle_retarget_new_page_failed", {
      message: error instanceof Error ? error.message : String(error),
    })
    setWallapopHandle(null)
  }
}

async function retargetHandleAfterUploadClose(
  current: WallapopBrowserHandle,
): Promise<void> {
  let remaining: Page[] = []
  try {
    remaining = current.context.pages().filter((p: Page) => !isClosedPage(p))
  } catch (error) {
    log("warn", "wallapop_upload_tab_retarget_pages_failed", {
      message: error instanceof Error ? error.message : String(error),
    })
    setWallapopHandle(null)
    return
  }
  if (await retargetToExistingPage(current, remaining)) return
  await retargetToNewWallPage(current)
}

/**
 * Close the owned upload tab used for this publish / dry-run (success or failure after attach).
 * Allowed during the publish busy lock. Does not disconnect Playwright and does not quit chrome.exe.
 * Never closes the session `/wall` tab (`ownedPage: false`) or login / 2FA tabs.
 */
function readUploadTabUrl(current: WallapopBrowserHandle): {
  url: string
  alreadyClosed: boolean
} {
  let url = ""
  let alreadyClosed = isClosedPage(current.page)
  if (!alreadyClosed) {
    try {
      url = current.page.url()
    } catch {
      alreadyClosed = true
    }
  }
  return { url, alreadyClosed }
}

async function closeOwnedUploadTab(
  current: WallapopBrowserHandle,
  url: string,
): Promise<void> {
  await current.page.close()
  log("info", "wallapop_upload_tab_closed", { url, ownedPage: true })
  await retargetHandleAfterUploadClose(current)
}

export async function closeWallapopUploadTab(): Promise<void> {
  const current = getWallapopHandle()
  if (!current) return
  try {
    const { url, alreadyClosed } = readUploadTabUrl(current)
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
    await closeOwnedUploadTab(current, url)
  } catch (error) {
    log("warn", "wallapop_upload_tab_close_failed", {
      message: error instanceof Error ? error.message : String(error),
    })
    try {
      await retargetHandleAfterUploadClose(current)
    } catch {
      if (isClosedPage(current.page)) setWallapopHandle(null)
    }
  }
}
