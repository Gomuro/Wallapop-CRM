import { log } from "./lib/log"
import { startWallapopAutopostLoop } from "./lib/wallapop-autopost"
import { startWallapopMonitorLoop } from "./lib/wallapop-monitor"
import { isWallapopOffline } from "./lib/wallapop-offline"
import { recoverStalePostingOnBoot } from "./lib/wallapop-posting-watchdog"
import { activateWarehouseForReadyQueueOnBoot } from "./lib/warehouse-inactive"

/**
 * Post-`listen` hooks. Keep `index.ts` as boot + listen only.
 */
export function runStartupHooks(): void {
  if (isWallapopOffline()) {
    log("info", "wallapop_offline_skip_loops")
  } else {
    startWallapopMonitorLoop()
    startWallapopAutopostLoop()
  }
  void recoverStalePostingOnBoot()
  void activateWarehouseForReadyQueueOnBoot()
}
