import type { Page } from "playwright"

import { log } from "../log"
import {
  ACTION_TIMEOUT_MS,
  ensureCdpAttached,
  isClosedPage,
  setWallapopHandle,
  type WallapopBrowserHandle,
} from "./attach"
import type { BrowserWorkerSlot } from "./busy"
import { closeWallapopUploadTab } from "./tabs"
import {
  clearWorkerPage,
  peekWorkerPage,
  registerSoldJobPage,
  setWorkerPage,
  takeSoldJobPages,
} from "./worker-pages"

type BrowserWithCdp = WallapopBrowserHandle["browser"] & {
  newBrowserCDPSession?: () => Promise<{
    send: (
      method: string,
      params?: Record<string, unknown>,
    ) => Promise<{ targetId?: string }>
  }>
}

async function waitForNewPage(
  handle: WallapopBrowserHandle,
  before: Set<Page>,
  timeoutMs = 8_000,
): Promise<Page | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const page of handle.context.pages()) {
      if (before.has(page) || isClosedPage(page)) continue
      page.setDefaultTimeout(ACTION_TIMEOUT_MS)
      await page.bringToFront().catch(() => {})
      return page
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return null
}

async function openOwnedWindow(handle: WallapopBrowserHandle): Promise<Page> {
  const before = new Set(handle.context.pages())
  const browser = handle.browser as BrowserWithCdp
  if (typeof browser.newBrowserCDPSession === "function") {
    try {
      const session = await browser.newBrowserCDPSession()
      await session.send("Target.createTarget", {
        url: "about:blank",
        newWindow: true,
      })
      const created = await waitForNewPage(handle, before)
      if (created) {
        log("info", "wallapop_worker_window_opened", { ownedPage: true })
        return created
      }
    } catch (error) {
      log("warn", "wallapop_worker_window_create_failed", {
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
  const page = await handle.context.newPage()
  page.setDefaultTimeout(ACTION_TIMEOUT_MS)
  await page.bringToFront().catch(() => {})
  log("info", "wallapop_worker_tab_fallback", { ownedPage: true })
  return page
}

export async function ensureWorkerWindow(
  slot: BrowserWorkerSlot,
): Promise<Page> {
  const handle = await ensureCdpAttached()
  const page = await openOwnedWindow(handle)
  setWorkerPage(slot, page)
  if (slot === "publish") {
    setWallapopHandle({ ...handle, page, ownedPage: true })
    log("info", "wallapop_upload_tab_opened", { ownedPage: true })
  } else if (slot === "sold") {
    registerSoldJobPage(page)
  }
  return page
}

/** Publish / dry-run: new window so `/wall` stays. */
export async function ensureWallapopPage(): Promise<Page> {
  return ensureWorkerWindow("publish")
}

export async function closeSoldJobPages(): Promise<void> {
  const pages = takeSoldJobPages()
  for (const page of pages) {
    if (isClosedPage(page)) continue
    await page.close().catch(() => {})
  }
}

/** Close the window this slot opened. Does not quit chrome.exe. */
export async function closeWorkerSlotPages(
  slot: BrowserWorkerSlot,
): Promise<void> {
  if (slot === "sold") {
    await closeSoldJobPages()
    return
  }
  if (slot === "publish") {
    await closeWallapopUploadTab()
    return
  }
  const page = peekWorkerPage(slot)
  clearWorkerPage(slot)
  if (!page || isClosedPage(page)) return
  await page.close().catch(() => {})
}
