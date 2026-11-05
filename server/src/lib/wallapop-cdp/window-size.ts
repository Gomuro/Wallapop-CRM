import type { BrowserContext, Page } from "playwright"

import { log } from "../log"
import { isClosedPage } from "./attach"
import { promiseWithin } from "./busy"

/**
 * A CDP call to a Chrome that went away may never return (VPS 2026-11-04 18:31Z).
 * The limit turns that into an ordinary error, so the job ends and frees its slot.
 */
export const WINDOW_CALL_MS = 20_000

async function maximizeWindowOf(page: Page, seen: Set<number>): Promise<void> {
  const session = await page.context().newCDPSession(page)
  const info = (await session.send("Browser.getWindowForTarget")) as {
    windowId?: number
  }
  const windowId = info.windowId
  if (windowId == null || seen.has(windowId)) {
    await session.detach().catch(() => {})
    return
  }
  seen.add(windowId)
  await session.send("Browser.setWindowBounds", {
    windowId,
    bounds: { windowState: "maximized" },
  })
  await session.detach().catch(() => {})
}

/** Fill the monitor so the Activos title column is not clipped with an ellipsis. */
export async function fitAccountWindows(context: BrowserContext): Promise<void> {
  const seen = new Set<number>()
  for (const page of context.pages()) {
    if (isClosedPage(page)) continue
    try {
      await promiseWithin(maximizeWindowOf(page, seen), WINDOW_CALL_MS, "Window size")
    } catch (error) {
      log("warn", "wallapop_window_size_failed", {
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
  if (seen.size > 0) {
    log("info", "wallapop_window_sized", {
      windows: seen.size,
      windowState: "maximized",
    })
  }
}
