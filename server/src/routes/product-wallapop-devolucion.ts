import type { Request, Response } from "express"

import { sendError } from "../lib/http-error"
import { log, serializeError } from "../lib/log"
import { deactivateListingAfterEliminar } from "../lib/product-eliminar"
import { requeueSoldProductAfterReturn } from "../lib/product-sold"
import { rescheduleAutopostLoop } from "../lib/wallapop-autopost"
import { isBrowserBusyError } from "../lib/wallapop-cdp"
import {
  eliminarWallapopInBrowser,
  WallapopEliminarError,
} from "../lib/wallapop-eliminar"
import { loadProductCard, paramId, toProductJson } from "./product-json"
import {
  prepareWallapopDevolucion,
  type RunWallapopDevolucionErr,
  type WallapopDevolucionReady,
} from "./product-wallapop-devolucion-prepare"

function sendPrepareErr(res: Response, err: RunWallapopDevolucionErr): void {
  sendError(res, err.httpStatus, err.code, err.message)
}

function mapEliminarBrowserError(error: unknown): RunWallapopDevolucionErr {
  if (isBrowserBusyError(error)) {
    return { ok: false, httpStatus: 409, code: "BROWSER_BUSY", message: error.message }
  }
  const step = error instanceof WallapopEliminarError ? error.step : "attach"
  const message =
    error instanceof Error ? error.message : "Error al eliminar en Wallapop."
  log("error", "wallapop_devolucion_eliminar_failed", {
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

async function persistDevolucionRequeue(
  ready: WallapopDevolucionReady,
  res: Response,
  eliminated: boolean,
): Promise<void> {
  const txResult = await requeueSoldProductAfterReturn(ready.prisma, ready.productId)
  if (txResult.kind === "not_found") {
    sendError(res, 404, "NOT_FOUND", "Producto no encontrado.")
    return
  }
  if (txResult.kind === "not_sold") {
    sendError(res, 409, "NOT_SOLD", "El producto no está vendido.")
    return
  }
  if (txResult.kind === "no_default_account") {
    sendError(res, 404, "NOT_FOUND", "La cuenta predeterminada no está configurada.")
    return
  }
  await rescheduleAutopostLoop()
  const product = await loadProductCard(ready.prisma, ready.productId)
  if (!product) {
    sendError(
      res,
      500,
      "DEVOLUCION_FAILED",
      "No se pudo recargar el producto después de la devolución.",
    )
    return
  }
  res.json({
    ok: true,
    dryRun: false,
    step: "requeued",
    eliminated,
    product: toProductJson(product),
    error: null,
  })
}

async function runPreparedDevolucion(
  prepared: WallapopDevolucionReady,
  res: Response,
): Promise<void> {
  if (!prepared.itemUrl) {
    await persistDevolucionRequeue(prepared, res, false)
    return
  }
  try {
    const browser = await eliminarWallapopInBrowser({
      itemUrl: prepared.itemUrl,
      dryRun: prepared.dryRun,
    })
    if (browser.dryRun) {
      res.json({
        ok: true,
        dryRun: true,
        step: browser.step,
        eliminated: false,
        product: null,
        error: null,
      })
      return
    }
    await deactivateListingAfterEliminar(prepared.prisma, prepared.productId)
    await persistDevolucionRequeue(prepared, res, true)
  } catch (error) {
    sendPrepareErr(res, mapEliminarBrowserError(error))
  }
}

export async function postProductWallapopDevolucion(req: Request, res: Response) {
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
  const prepared = await prepareWallapopDevolucion(productId, { dryRun })
  if (!prepared.ok) {
    sendPrepareErr(res, prepared)
    return
  }
  await runPreparedDevolucion(prepared, res)
}
