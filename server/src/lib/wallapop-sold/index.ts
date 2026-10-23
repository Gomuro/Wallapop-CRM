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
  soldErrorAt,
  SoldStep,
  WallapopSoldError,
} from "./types"

export type { MarkWallapopSoldInput, MarkWallapopSoldResult, SoldStep }
export { WallapopSoldError }
export {
  CLICK_MARK_AS_SOLD_EVAL,
  CLICK_SELLER_SOLD_EVAL,
  FIND_ITEM_ALREADY_SOLD_EVAL,
  FIND_SELLER_SOLD_EVAL,
  findItemAlreadySold,
  findSellerSoldButton,
} from "./click"
export {
  firstSoldCatalogHrefMatches,
  soldCatalogHrefMatches,
  SOLD_CATALOG_ROWS_EVAL,
} from "./verify"

async function markWallapopSoldInner(
  input: MarkWallapopSoldInput,
): Promise<MarkWallapopSoldResult> {
  const page = await ensureWorkerWindow("sold", input.cdpPort)
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
    const failed = soldErrorAt(step, error)
    log("error", "wallapop_sold_abort", {
      step: failed.step,
      message: failed.message,
      url: page.isClosed() ? null : page.url(),
      err: serializeError(error),
    })
    throw failed
  }
}

export async function markWallapopSoldInBrowser(
  input: MarkWallapopSoldInput,
): Promise<MarkWallapopSoldResult> {
  try {
    return await runWithBrowserBusy(
      "sold",
      () => markWallapopSoldInner(input),
      input.cdpPort,
    )
  } finally {
    await closeSoldJobPages(input.cdpPort)
    if (!input.dryRun) await quitChromeIfNoWorkerSlots(input.cdpPort)
  }
}
