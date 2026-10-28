import { startListingVariantWorker } from "./lib/listing-variant/worker"
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
  // Talks to the AI only, never to Wallapop, so it also runs offline.
  if (process.env.LISTING_VARIANT_WORKER !== "0") startListingVariantWorker()
  void recoverStalePostingOnBoot()
  void activateWarehouseForReadyQueueOnBoot()
}
