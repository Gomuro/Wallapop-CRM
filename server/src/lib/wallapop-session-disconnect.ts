import { isBrowserBusyError } from "./wallapop-cdp"
import { log } from "./log"
import { closeWallapopBrowser, logoutWallapopInBrowser } from "./wallapop-browser"
import {
  beginWallapopDisconnect,
  cancelWallapopDisconnect,
  finishWallapopDisconnect,
  type WallapopSessionSnapshot,
} from "./wallapop-session"

export async function disconnectWallapopSession(): Promise<WallapopSessionSnapshot> {
  beginWallapopDisconnect()
  try {
    await logoutWallapopInBrowser()
  } catch (error) {
    if (isBrowserBusyError(error)) {
      cancelWallapopDisconnect()
      throw error
    }
    log("warn", "wallapop_disconnect_logout_error", {
      message: error instanceof Error ? error.message : String(error),
    })
    await closeWallapopBrowser()
  }
  return finishWallapopDisconnect()
}
