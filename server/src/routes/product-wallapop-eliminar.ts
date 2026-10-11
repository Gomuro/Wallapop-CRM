import type { Request, Response } from "express"

import { sendError } from "../lib/http-error"
import { log, serializeError } from "../lib/log"
import { deactivateListingAfterEliminar } from "../lib/product-eliminar"
import { isBrowserBusyError } from "../lib/wallapop-cdp"
import {
  eliminarWallapopInBrowser,
  WallapopEliminarError,
} from "../lib/wallapop-eliminar"
import { loadProductCard, paramId, toProductJson } from "./product-json"
import {
  prepareWallapopEliminar,
  type RunWallapopEliminarErr,
  type WallapopEliminarReady,
} from "./product-wallapop-eliminar-prepare"

function sendPrepareErr(res: Response, err: RunWallapopEliminarErr): void {
  sendError(res, err.httpStatus, err.code, err.message)
}

function mapEliminarBrowserError(error: unknown): RunWallapopEliminarErr {
  if (isBrowserBusyError(error)) {
    return { ok: false, httpStatus: 409, code: "BROWSER_BUSY", message: error.message }
  }
  const step = error instanceof WallapopEliminarError ? error.step : "attach"
  const message =
    error instanceof Error ? error.message : "Error al eliminar en Wallapop."
  log("error", "wallapop_eliminar_http_failed", {
    step,
    message,
    err: serializeError(error),
  })
  return {
    ok: false,
    httpStatus: 500,
    code: "ELIMINAR_FAILED",
    message: `${step}: ${message}`,
  }
}

async function persistCrmEliminar(
  ready: WallapopEliminarReady,
  res: Response,
): Promise<void> {
  await deactivateListingAfterEliminar(ready.prisma, ready.productId)
  const product = await loadProductCard(ready.prisma, ready.productId)
  if (!product) {
    sendError(
      res,
      500,
      "ELIMINAR_FAILED",
      "Eliminado en Wallapop; no se pudo recargar el producto.",
    )
    return
  }
  res.json({
    ok: true,
    dryRun: false,
    step: "eliminated",
    product: toProductJson(product),
    error: null,
  })
}

async function runPreparedEliminar(
  prepared: WallapopEliminarReady,
  res: Response,
): Promise<void> {
  try {
    const browser = await eliminarWallapopInBrowser({
      itemUrl: prepared.itemUrl,
      dryRun: prepared.dryRun,
    })
    if (browser.dryRun) {
      res.json({ ok: true, dryRun: true, step: browser.step, product: null, error: null })
      return
    }
    await persistCrmEliminar(prepared, res)
  } catch (error) {
    sendPrepareErr(res, mapEliminarBrowserError(error))
  }
}

export async function postProductWallapopEliminar(req: Request, res: Response) {
  const productId = paramId(req)
  if (!productId) {
    sendError(res, 404, "NOT_FOUND", "Producto no encontrado.")
    return
  }
  const raw: unknown = req.body ?? {}
  const dryRun =
    typeof raw === "object" &&
    raw !== null &&
    (raw as { dryRun?: unknown }).dryRun === true
  const prepared = await prepareWallapopEliminar(productId, { dryRun })
  if (!prepared.ok) {
    sendPrepareErr(res, prepared)
    return
  }
  await runPreparedEliminar(prepared, res)
}
