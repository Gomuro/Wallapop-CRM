import {
  closeSoldJobPages,
  ensureWorkerWindow,
  quitChromeIfNoWorkerSlots,
  runWithBrowserBusy,
} from "../wallapop-cdp"
import { log, serializeError } from "../log"
import { runSoldAfterAttach } from "./flow"
import {
  MarkWallapopSoldInput,
  MarkWallapopSoldResult,
  SoldStep,
  WallapopSoldError,
} from "./types"

export type { MarkWallapopSoldInput, MarkWallapopSoldResult, SoldStep }
export { WallapopSoldError }
export {
  CLICK_MARK_AS_SOLD_EVAL,
  CLICK_SELLER_SOLD_EVAL,
  FIND_SELLER_SOLD_EVAL,
  findSellerSoldButton,
} from "./click"
export {
  firstSoldCatalogHrefMatches,
  SOLD_CATALOG_ROWS_EVAL,
} from "./verify"

async function markWallapopSoldInner(
  input: MarkWallapopSoldInput,
): Promise<MarkWallapopSoldResult> {
  const page = await ensureWorkerWindow("sold")
  let step: SoldStep = "attach"
  log("info", "wallapop_sold_start", {
    itemUrl: input.itemUrl,
    dryRun: input.dryRun,
  })
  try {
    return await runSoldAfterAttach(input, page, (next) => {
      step = next
    })
  } catch (error) {
    const failStep = error instanceof WallapopSoldError ? error.step : step
    const message = error instanceof Error ? error.message : String(error)
    log("error", "wallapop_sold_abort", {
      step: failStep,
      message,
      err: serializeError(error),
    })
    throw error
  }
}

export async function markWallapopSoldInBrowser(
  input: MarkWallapopSoldInput,
): Promise<MarkWallapopSoldResult> {
  try {
    return await runWithBrowserBusy("sold", () => markWallapopSoldInner(input))
  } finally {
    await closeSoldJobPages()
    if (!input.dryRun) await quitChromeIfNoWorkerSlots()
  }
}
