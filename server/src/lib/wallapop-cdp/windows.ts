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
  isOwnedWorkerPage,
  listOwnedWorkerPages,
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

const WINDOW_WAIT_MS = 12_000

/** Clicks need focus. Monitor scrapes in the background and must not steal Eliminar. */
const FOREGROUND_SLOTS: ReadonlySet<BrowserWorkerSlot> = new Set([
  "publish",
  "sold",
  "eliminar",
  "session",
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

async function waitForTargetPage(
  handle: WallapopBrowserHandle,
  before: Set<Page>,
  targetId: string | null,
  timeoutMs = WINDOW_WAIT_MS,
): Promise<Page | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const page of handle.context.pages()) {
      if (
        !canClaimWorkerPage({
          wasAlreadyOpen: before.has(page),
          isClosed: isClosedPage(page),
          ownedByOtherSlot: isOwnedWorkerPage(page),
        })
      ) {
        continue
      }
      if (targetId) {
        const id = await targetIdOf(page)
        if (id && id !== targetId) continue
      }
      page.setDefaultTimeout(ACTION_TIMEOUT_MS)
      return page
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return null
}

async function openOwnedWindow(
  handle: WallapopBrowserHandle,
  slot: BrowserWorkerSlot,
  port?: number,
): Promise<Page> {
  const before = new Set(handle.context.pages())
  const browser = handle.browser as BrowserWithCdp
  if (typeof browser.newBrowserCDPSession === "function") {
    try {
      const session = await browser.newBrowserCDPSession()
      const created = await session.send("Target.createTarget", {
        url: "about:blank",
        newWindow: true,
      })
      const page = await waitForTargetPage(handle, before, created.targetId ?? null)
      if (page) {
        if (FOREGROUND_SLOTS.has(slot)) {
          await page.bringToFront().catch(() => {})
        }
        log("info", "wallapop_worker_window_opened", {
          slot,
          ownedPage: true,
          targetId: created.targetId ?? null,
        })
        return page
      }
      log("warn", "wallapop_worker_window_target_missing", {
        slot,
        targetId: created.targetId ?? null,
      })
    } catch (error) {
      log("warn", "wallapop_worker_window_create_failed", {
        slot,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
  if (listOwnedWorkerPages(port).length > 0) {
    throw new Error(
      `No se pudo abrir una ventana propia para «${slot}»; no se reutiliza la pestaña de otro worker.`,
    )
  }
  const page = await handle.context.newPage()
  page.setDefaultTimeout(ACTION_TIMEOUT_MS)
  if (FOREGROUND_SLOTS.has(slot)) {
    await page.bringToFront().catch(() => {})
  }
  log("info", "wallapop_worker_tab_fallback", { slot, ownedPage: true })
  return page
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
export async function ensureWallapopPage(): Promise<Page> {
  return ensureWorkerWindow("publish")
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
