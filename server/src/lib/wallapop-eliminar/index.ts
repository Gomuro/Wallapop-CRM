import {
  closeWorkerSlotPages,
  ensureWorkerWindow,
  quitChromeIfNoWorkerSlots,
  runWithBrowserBusy,
} from "../wallapop-cdp"
import { log, serializeError } from "../log"
import { runEliminarAfterAttach } from "./flow"
import {
  type EliminarStep,
  type EliminarWallapopInput,
  type EliminarWallapopResult,
  WallapopEliminarError,
} from "./types"

export type { EliminarStep, EliminarWallapopInput, EliminarWallapopResult }
export { WallapopEliminarError }
export {
  CLICK_CONFIRM_ELIMINAR_EVAL,
  CLICK_SELLER_ELIMINAR_EVAL,
  FIND_ELIMINAR_DIALOG_EVAL,
  FIND_SELLER_ELIMINAR_EVAL,
} from "./click"
export { cacheBustItemUrl, publishedRowsContainItem } from "./verify"

async function eliminarInner(
  input: EliminarWallapopInput,
): Promise<EliminarWallapopResult> {
  const page = await ensureWorkerWindow("eliminar")
  let step: EliminarStep = "attach"
  log("info", "wallapop_eliminar_start", {
    itemUrl: input.itemUrl,
    dryRun: input.dryRun,
  })
  try {
    return await runEliminarAfterAttach(input, page, (next) => {
      step = next
    })
  } catch (error) {
    const failStep = error instanceof WallapopEliminarError ? error.step : step
    log("error", "wallapop_eliminar_abort", {
      step: failStep,
      message: error instanceof Error ? error.message : String(error),
      err: serializeError(error),
    })
    throw error
  } finally {
    await closeWorkerSlotPages("eliminar")
  }
}

/** Own window in the shared Chrome; quits Chrome afterwards if every slot is idle. */
export async function eliminarWallapopInBrowser(
  input: EliminarWallapopInput,
): Promise<EliminarWallapopResult> {
  try {
    return await runWithBrowserBusy("eliminar", () => eliminarInner(input))
  } finally {
    if (!input.dryRun) await quitChromeIfNoWorkerSlots()
  }
}
