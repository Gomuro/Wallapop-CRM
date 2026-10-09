import { startWallapopAutopostLoop } from "./lib/wallapop-autopost"
import { startWallapopMonitorLoop } from "./lib/wallapop-monitor"
import { recoverStalePostingOnBoot } from "./lib/wallapop-posting-watchdog"

/**
 * Post-`listen` hooks. Keep `index.ts` as boot + listen only.
 */
export function runStartupHooks(): void {
  startWallapopMonitorLoop()
  startWallapopAutopostLoop()
  void recoverStalePostingOnBoot()
}
