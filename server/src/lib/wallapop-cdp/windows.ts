import type { BrowserContext, Page } from "playwright"

import { log } from "../log"
import {
  ACCOUNT_WINDOW_HEIGHT,
  ACCOUNT_WINDOW_WIDTH,
  ACTION_TIMEOUT_MS,
  ensureCdpAttached,
  isClosedPage,
  navigateViaAssign,
  setWallapopHandle,
  WALLAPOP_WALL_URL,
  type WallapopBrowserHandle,
} from "./attach"
import type { BrowserWorkerSlot } from "./busy"
import { closeWallapopUploadTab, quitChromeIfNoWorkerSlots } from "./tabs"
import {
  clearWorkerPage,
  isOwnedWorkerPage,
  listOwnedWorkerPages,
  peekWatchPage,
  peekWorkerPage,
  pinWatchPage,
  registerSoldJobPage,
  releaseWatchPage,
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

const WINDOW_WAIT_MS = 12_000

/** One size for every account. A restored profile window is put back to this. */
export async function fitAccountWindows(context: BrowserContext): Promise<void> {
  const seen = new Set<number>()
  for (const page of context.pages()) {
    if (isClosedPage(page)) continue
    try {
      const session = await page.context().newCDPSession(page)
      const info = (await session.send("Browser.getWindowForTarget")) as {
        windowId?: number
      }
      const windowId = info.windowId
      if (windowId == null || seen.has(windowId)) {
        await session.detach().catch(() => {})
        continue
      }
      seen.add(windowId)
      await session.send("Browser.setWindowBounds", {
        windowId,
        bounds: {
          width: ACCOUNT_WINDOW_WIDTH,
          height: ACCOUNT_WINDOW_HEIGHT,
          windowState: "normal",
        },
      })
      await session.detach().catch(() => {})
    } catch (error) {
      log("warn", "wallapop_window_size_failed", {
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
  if (seen.size > 0) {
    log("info", "wallapop_window_sized", {
      windows: seen.size,
      width: ACCOUNT_WINDOW_WIDTH,
      height: ACCOUNT_WINDOW_HEIGHT,
    })
  }
}

/** Clicks need focus. Monitor scrapes in the background and must not steal Eliminar. */
const FOREGROUND_SLOTS: ReadonlySet<BrowserWorkerSlot> = new Set([
  "publish",
  "sold",
  "eliminar",
  "session",
  "reserve",
])

export function canClaimWorkerPage(input: {
  wasAlreadyOpen: boolean
  isClosed: boolean
  ownedByOtherSlot: boolean
}): boolean {
  return !input.wasAlreadyOpen && !input.isClosed && !input.ownedByOtherSlot
}

async function targetIdOf(page: Page): Promise<string | null> {
  try {
    const session = await page.context().newCDPSession(page)
    const info = (await session.send("Target.getTargetInfo")) as {
      targetInfo?: { targetId?: string }
    }
    await session.detach().catch(() => {})
    return info.targetInfo?.targetId ?? null
  } catch {
    return null
  }
}

async function pageIsTarget(
  page: Page,
  before: Set<Page>,
  targetId: string | null,
): Promise<boolean> {
  if (
    !canClaimWorkerPage({
      wasAlreadyOpen: before.has(page),
      isClosed: isClosedPage(page),
      ownedByOtherSlot: isOwnedWorkerPage(page),
    })
  ) {
    return false
  }
  if (!targetId) return true
  const id = await targetIdOf(page)
  return !id || id === targetId
}

async function waitForTargetPage(
  handle: WallapopBrowserHandle,
  before: Set<Page>,
  targetId: string | null,
  timeoutMs = WINDOW_WAIT_MS,
): Promise<Page | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const page of handle.context.pages()) {
      if (!(await pageIsTarget(page, before, targetId))) continue
      page.setDefaultTimeout(ACTION_TIMEOUT_MS)
      return page
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return null
}

type OwnedWindowOptions = {
  logSlot?: string
  claim?: (page: Page) => void
}

async function focusClaimedPage(
  page: Page,
  handle: WallapopBrowserHandle,
  slot: BrowserWorkerSlot,
  claim?: (page: Page) => void,
): Promise<void> {
  page.setDefaultTimeout(ACTION_TIMEOUT_MS)
  claim?.(page)
  if (FOREGROUND_SLOTS.has(slot)) {
    await page.bringToFront().catch(() => {})
  }
  await fitAccountWindows(handle.context)
}

async function openCreatedTarget(
  handle: WallapopBrowserHandle,
  slot: BrowserWorkerSlot,
  logSlot: string,
  claim?: (page: Page) => void,
): Promise<Page | null> {
  const before = new Set(handle.context.pages())
  const browser = handle.browser as BrowserWithCdp
  if (typeof browser.newBrowserCDPSession !== "function") return null
  try {
    const session = await browser.newBrowserCDPSession()
    const created = await session.send("Target.createTarget", {
      url: "about:blank",
      newWindow: true,
    })
    const page = await waitForTargetPage(handle, before, created.targetId ?? null)
    if (!page) {
      log("warn", "wallapop_worker_window_target_missing", {
        slot: logSlot,
        targetId: created.targetId ?? null,
      })
      return null
    }
    await focusClaimedPage(page, handle, slot, claim)
    log("info", "wallapop_worker_window_opened", {
      slot: logSlot,
      ownedPage: true,
      targetId: created.targetId ?? null,
    })
    return page
  } catch (error) {
    log("warn", "wallapop_worker_window_create_failed", {
      slot: logSlot,
      message: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

async function openFallbackTab(
  handle: WallapopBrowserHandle,
  slot: BrowserWorkerSlot,
  port: number | undefined,
  options: { logSlot: string; claim?: (page: Page) => void },
): Promise<Page> {
  if (listOwnedWorkerPages(port).length > 0) {
    throw new Error(
      `No se pudo abrir una ventana propia para «${options.logSlot}»; no se reutiliza la pestaña de otro worker.`,
    )
  }
  const page = await handle.context.newPage()
  await focusClaimedPage(page, handle, slot, options.claim)
  log("info", "wallapop_worker_tab_fallback", {
    slot: options.logSlot,
    ownedPage: true,
  })
  return page
}

async function openOwnedWindow(
  handle: WallapopBrowserHandle,
  slot: BrowserWorkerSlot,
  port?: number,
  options?: OwnedWindowOptions,
): Promise<Page> {
  const logSlot = options?.logSlot ?? slot
  const created = await openCreatedTarget(handle, slot, logSlot, options?.claim)
  if (created) return created
  return openFallbackTab(handle, slot, port, { logSlot, claim: options?.claim })
}

export async function ensureWorkerWindow(
  slot: BrowserWorkerSlot,
  port?: number,
): Promise<Page> {
  const handle = await ensureCdpAttached(port)
  const page = await openOwnedWindow(handle, slot, port)
  setWorkerPage(slot, page, port)
  if (slot === "publish") {
    setWallapopHandle({ ...handle, page, ownedPage: true }, port)
    log("info", "wallapop_upload_tab_opened", { ownedPage: true })
  } else if (slot === "sold") {
    registerSoldJobPage(page, port)
  }
  return page
}

/** Publish / dry-run: new window so `/wall` stays. */
export async function ensureWallapopPage(port?: number): Promise<Page> {
  return ensureWorkerWindow("publish", port)
}

export async function closeSoldJobPages(port?: number): Promise<void> {
  const pages = takeSoldJobPages(port)
  for (const page of pages) {
    if (isClosedPage(page)) continue
    await page.close().catch(() => {})
  }
}

/** Close the window this slot opened. Does not quit chrome.exe. */
export async function closeWorkerSlotPages(
  slot: BrowserWorkerSlot,
  port?: number,
): Promise<void> {
  if (slot === "sold") {
    await closeSoldJobPages(port)
    return
  }
  if (slot === "publish") {
    await closeWallapopUploadTab(port)
    return
  }
  const page = peekWorkerPage(slot, port)
  clearWorkerPage(slot, port)
  if (!page || isClosedPage(page)) return
  await page.close().catch(() => {})
}

/**
 * Developer window on this account's Chrome. Jobs keep their own windows.
 * This one stays until the developer closes it; then Chrome may quit if idle.
 */
export async function openDevWatchWindow(port: number): Promise<void> {
  const existing = peekWatchPage(port)
  if (existing) {
    await fitAccountWindows(existing.context())
    await existing.bringToFront().catch(() => {})
    return
  }
  const handle = await ensureCdpAttached(port)
  const page = await openOwnedWindow(handle, "session", port, {
    logSlot: "watch",
    claim: (opened) => {
      pinWatchPage(opened, port)
      opened.once("close", () => {
        releaseWatchPage(opened, port)
        void quitChromeIfNoWorkerSlots(port)
      })
    },
  })
  await page.bringToFront().catch(() => {})
  await navigateViaAssign(page, WALLAPOP_WALL_URL)
  log("info", "wallapop_dev_watch_opened", { port, url: page.url() })
}
