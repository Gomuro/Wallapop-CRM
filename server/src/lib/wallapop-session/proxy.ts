import { parseChromeProxy } from "../../../../lib/accounts/chrome-proxy"
import { log } from "../log"
import {
  closeWallapopBrowser,
  isBrowserBusyError,
  rememberChromeProxy,
} from "../wallapop-cdp"
import { resolveAccountTarget, sessionRow, snapshotOf } from "./state"
import type { WallapopSessionSnapshot } from "./state"

/**
 * Persist proxy for this Chrome slot and quit chrome.exe.
 * Does not logout Wallapop. The same user-data-dir keeps cookies and history.
 * The next worker spawn starts Chrome with the local auth forwarder.
 */
export async function applyWallapopChromeProxy(input: {
  proxy: string | null
  accountId?: string
}): Promise<WallapopSessionSnapshot> {
  const target = await resolveAccountTarget(input.accountId)
  const parsed = parseChromeProxy(input.proxy)
  rememberChromeProxy(target.port, input.proxy)
  log("info", "wallapop_proxy_applied", {
    accountId: target.accountId,
    port: target.port,
    proxyUpstream: parsed?.server ?? null,
    proxyAuth: Boolean(parsed?.username),
  })
  try {
    await closeWallapopBrowser(target.port)
  } catch (error) {
    if (isBrowserBusyError(error)) throw error
    log("warn", "wallapop_proxy_chrome_quit_failed", {
      port: target.port,
      message: error instanceof Error ? error.message : String(error),
    })
  }
  return snapshotOf(sessionRow(target.accountId))
}
