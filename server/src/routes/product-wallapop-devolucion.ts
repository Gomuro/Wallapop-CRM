import type { Request, Response } from "express"

import { chromePortForAccount } from "../lib/account-chrome"
import { readActionAccountId } from "../lib/foreign-chrome"
import { sendError } from "../lib/http-error"
import { log, serializeError } from "../lib/log"
import { deactivateListingAfterEliminar } from "../lib/product-eliminar"
import { requeueSoldProductAfterReturn } from "../lib/product-sold"
import { rescheduleAutopostLoop } from "../lib/wallapop-autopost"
import { enqueueWorkerJob } from "../lib/wallapop-worker-jobs"
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

async function applyDevolucionRequeue(ready: WallapopDevolucionReady): Promise<void> {
  const txResult = await requeueSoldProductAfterReturn(ready.prisma, ready.productId)
  if (txResult.kind === "not_found") {
    throw new Error("Producto no encontrado.")
  }
  if (txResult.kind === "not_sold") {
    throw new Error("El producto no está vendido.")
  }
  if (txResult.kind === "no_default_account") {
    throw new Error("La cuenta predeterminada no está configurada.")
  }
  await rescheduleAutopostLoop()
}

async function persistDevolucionRequeue(
  ready: WallapopDevolucionReady,
  res: Response,
  eliminated: boolean,
): Promise<void> {
  try {
    await applyDevolucionRequeue(ready)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error"
    if (message === "El producto no está vendido.") {
      sendError(res, 409, "NOT_SOLD", message)
      return
    }
    if (message === "La cuenta predeterminada no está configurada.") {
      sendError(res, 404, "NOT_FOUND", message)
      return
    }
    sendError(res, 404, "NOT_FOUND", "Producto no encontrado.")
    return
  }
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

export async function runWallapopDevolucionJob(
  ready: WallapopDevolucionReady,
): Promise<void> {
  try {
    if (!ready.itemUrl) {
      await applyDevolucionRequeue(ready)
      return
    }
    const browser = await eliminarWallapopInBrowser({
      itemUrl: ready.itemUrl,
      dryRun: ready.dryRun,
      cdpPort: await chromePortForAccount(ready.accountId),
    })
    if (browser.dryRun) return
    await deactivateListingAfterEliminar(ready.prisma, ready.productId, ready.accountId)
    await applyDevolucionRequeue(ready)
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (
      message === "Producto no encontrado." ||
      message === "El producto no está vendido." ||
      message === "La cuenta predeterminada no está configurada."
    ) {
      throw error
    }
    throw new Error(mapEliminarBrowserError(error).message)
  }
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
      cdpPort: await chromePortForAccount(prepared.accountId),
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
    await deactivateListingAfterEliminar(
      prepared.prisma,
      prepared.productId,
      prepared.accountId,
    )
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
  const prepared = await prepareWallapopDevolucion(productId, {
    dryRun,
    accountId: readActionAccountId(raw),
  })
  if (!prepared.ok) {
    sendPrepareErr(res, prepared)
    return
  }
  if (prepared.dryRun || !prepared.itemUrl) {
    await runPreparedDevolucion(prepared, res)
    return
  }
  const titled = await prepared.prisma.product.findUnique({
    where: { id: prepared.productId },
    select: { title: true },
  })
  const queued = enqueueWorkerJob({
    kind: "devolucion",
    productId: prepared.productId,
    title: titled?.title ?? "Producto",
    run: () => runWallapopDevolucionJob(prepared),
  })
  if (!queued.ok) {
    sendError(res, 409, "ALREADY_QUEUED", queued.message)
    return
  }
  res.json({
    ok: true,
    queued: true,
    dryRun: false,
    step: "queued",
    eliminated: false,
    product: null,
    error: null,
  })
}
