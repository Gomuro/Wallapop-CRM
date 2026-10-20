import {
  closeWorkerSlotPages,
  ensureWorkerWindow,
  quitChromeIfNoWorkerSlots,
  runWithBrowserBusy,
} from "../wallapop-cdp"
import { log, serializeError } from "../log"
import { runReserveAfterAttach, runUnreserveAfterAttach } from "./flow"
import {
  type MarkWallapopReservedInput,
  type MarkWallapopReservedResult,
  type MarkWallapopUnreservedResult,
  WallapopReserveError,
} from "./types"

export type {
  MarkWallapopReservedInput,
  MarkWallapopReservedResult,
  MarkWallapopUnreservedResult,
}
export { WallapopReserveError }
export {
  CLICK_SELLER_RESERVE_EVAL,
  CLICK_SELLER_UNRESERVE_EVAL,
  FIND_SELLER_RESERVE_EVAL,
} from "./click"

async function markWallapopUnreservedInner(
  input: MarkWallapopReservedInput,
): Promise<MarkWallapopUnreservedResult> {
  const page = await ensureWorkerWindow("reserve", input.cdpPort)
  log("info", "wallapop_unreserve_start", { itemUrl: input.itemUrl, port: input.cdpPort })
  try {
    return await runUnreserveAfterAttach(input.itemUrl, page)
  } catch (error) {
    log("error", "wallapop_unreserve_abort", {
      message: error instanceof Error ? error.message : String(error),
      err: serializeError(error),
    })
    throw error
  }
}

export async function markWallapopUnreservedInBrowser(
  input: MarkWallapopReservedInput,
): Promise<MarkWallapopUnreservedResult> {
  try {
    return await runWithBrowserBusy(
      "reserve",
      () => markWallapopUnreservedInner(input),
      input.cdpPort,
    )
  } finally {
    await closeWorkerSlotPages("reserve", input.cdpPort)
    await quitChromeIfNoWorkerSlots(input.cdpPort)
  }
}

async function markWallapopReservedInner(
  input: MarkWallapopReservedInput,
): Promise<MarkWallapopReservedResult> {
  const page = await ensureWorkerWindow("reserve", input.cdpPort)
  log("info", "wallapop_reserve_start", { itemUrl: input.itemUrl, port: input.cdpPort })
  try {
    return await runReserveAfterAttach(input.itemUrl, page)
  } catch (error) {
    log("error", "wallapop_reserve_abort", {
      message: error instanceof Error ? error.message : String(error),
      err: serializeError(error),
    })
    throw error
  }
}

export async function markWallapopReservedInBrowser(
  input: MarkWallapopReservedInput,
): Promise<MarkWallapopReservedResult> {
  try {
    return await runWithBrowserBusy(
      "reserve",
      () => markWallapopReservedInner(input),
      input.cdpPort,
    )
  } finally {
    await closeWorkerSlotPages("reserve", input.cdpPort)
    await quitChromeIfNoWorkerSlots(input.cdpPort)
  }
}
