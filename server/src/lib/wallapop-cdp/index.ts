/**
 * Shared Chrome CDP attach / page helpers.
 * Login: wallapop-browser/. Publish: wallapop-publish/.
 */
import type { Locator, Page } from "playwright"

import { throwIfPublishAborted } from "./busy"

export {
  ACTION_TIMEOUT_MS,
  attachOrLaunch,
  CDP_PORT,
  CDP_URL,
  connectCdpHandle,
  ensureWallapopPage,
  getWallapopHandle,
  hasOpenWallapopBrowser,
  isClosedPage,
  isHandleAlive,
  killSpawnedChrome,
  NAV_TIMEOUT_MS,
  navigateViaAssign,
  setWallapopHandle,
  WALLAPOP_WALL_URL,
  type WallapopBrowserHandle,
} from "./attach"

export {
  abortInFlightPublish,
  assertBrowserIdle,
  BrowserBusyError,
  consumeKeepChromeAfterAbort,
  getBrowserBusy,
  isBrowserBusyError,
  isBrowserPublishBusy,
  isInFlightPublishAborted,
  isPublishAbortedError,
  PublishAbortedError,
  resetWallapopPublishAbortForTests,
  runWithBrowserBusy,
  throwIfPublishAborted,
  type BrowserBusy,
} from "./busy"

export {
  closeWallapopBrowser,
  closeWallapopUploadTab,
  isLoginOr2faUrl,
  isWallFeedUrl,
  pickLiveSessionPage,
  quitWallapopChrome,
  shouldCloseUploadTab,
  type PageUrlSnapshot,
} from "./tabs"

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
