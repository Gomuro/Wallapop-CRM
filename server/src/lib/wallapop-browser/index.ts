/**
 * Wallapop email login / 2FA / logout via Chrome CDP.
 * Shared CDP attach: wallapop-cdp/. Publish: wallapop-publish/.
 */
import {
  closeWallapopBrowser,
  connectCdpHandle,
  CDP_URL,
  getWallapopHandle,
  hasOpenWallapopBrowser,
  NAV_TIMEOUT_MS,
  runWithBrowserBusy,
  setWallapopHandle,
} from "../wallapop-cdp"
import { log } from "../log"

export { closeWallapopBrowser, hasOpenWallapopBrowser }
export {
  loginWallapopInBrowser,
  type BrowserLoginOutcome,
} from "./login"
export {
  classifyOwnedSessionWindow,
  reconcileWallapopBrowserState,
  reconcileWallapopBrowserStateSpawning,
  submitWallapop2faInBrowser,
  type ReconcileBrowserState,
} from "./reconcile"

const LOGIN_URL = "https://es.wallapop.com/login"

export async function logoutWallapopInBrowser(): Promise<void> {
  await runWithBrowserBusy("logout", async () => {
    try {
      let handle = getWallapopHandle()
      if (!handle) {
        handle = await connectCdpHandle()
        setWallapopHandle(handle)
        log("info", "wallapop_logout_attached_cdp", { cdpUrl: CDP_URL })
      }

      const { context, page } = handle
      await context.clearCookies()

      await page
        .goto("https://es.wallapop.com/logout", {
          waitUntil: "domcontentloaded",
          timeout: NAV_TIMEOUT_MS,
        })
        .catch(() => {})

      await page
        .goto(LOGIN_URL, {
          waitUntil: "domcontentloaded",
          timeout: NAV_TIMEOUT_MS,
        })
        .catch(() => {})

      log("info", "wallapop_logout_done", { url: page.url() })
    } catch (error) {
      log("warn", "wallapop_logout_failed", {
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      await closeWallapopBrowser()
    }
  })
}
