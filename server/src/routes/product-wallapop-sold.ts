import type { Request, Response } from "express"
import { ZodError } from "zod"

import { productSoldBodySchema } from "../../../lib/validations/product"
import { chromePortForAccount } from "../lib/account-chrome"
import { readActionAccountId } from "../lib/foreign-chrome"
import { sendError } from "../lib/http-error"
import { isBrowserBusyError } from "../lib/wallapop-cdp"
import { markProductSoldTx } from "../lib/product-sold"
import { scheduleSiblingEliminar } from "../lib/sibling-eliminar"
import { markWallapopSoldInBrowser, WallapopSoldError } from "../lib/wallapop-sold"
import { enqueueWorkerJob } from "../lib/wallapop-worker-jobs"
import { log, serializeError } from "../lib/log"
import { loadProductCard, paramId, sendZod, toProductJson } from "./product-json"
import {
  prepareWallapopSold,
  type RunWallapopSoldErr,
  type WallapopSoldReady,
} from "./product-wallapop-sold-prepare"

function parseWallapopSoldBody(req: Request) {
  const raw = req.body ?? {}
  const parsed = productSoldBodySchema.parse(raw)
  const dryRun =
    typeof raw === "object" && raw !== null && (raw as { dryRun?: unknown }).dryRun === true
  return { ...parsed, dryRun }
}

function sendPrepareErr(res: Response, err: RunWallapopSoldErr): void {
  sendError(res, err.httpStatus, err.code, err.message)
}

async function applyCrmSold(ready: WallapopSoldReady): Promise<void> {
  const txResult = await markProductSoldTx(ready.prisma, ready.productId, {
    soldPrice: ready.soldPrice,
    accountId: ready.accountId,
  })
  if (txResult.kind === "not_found") {
    throw new Error("Producto no encontrado.")
  }
  if (txResult.kind === "already_sold") {
    throw new Error("Product is already sold.")
  }
  void scheduleSiblingEliminar(ready.productId, ready.accountId)
}

async function persistCrmSold(ready: WallapopSoldReady, res: Response) {
  try {
    await applyCrmSold(ready)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error"
    if (message === "Producto no encontrado.") {
      sendError(res, 404, "NOT_FOUND", "Product not found.")
      return
    }
    sendError(res, 409, "ALREADY_SOLD", "Product is already sold.")
    return
  }
  const product = await loadProductCard(ready.prisma, ready.productId)
  if (!product) {
    sendError(res, 500, "SOLD_FAILED", "Wallapop ya está vendido; no se pudo recargar el producto.")
    return
  }
  res.json({
    ok: true,
    dryRun: false,
    step: "sold",
    product: toProductJson(product),
    error: null,
  })
}

function mapSoldBrowserError(error: unknown): RunWallapopSoldErr {
  if (isBrowserBusyError(error)) {
    return {
      ok: false,
      httpStatus: 409,
      code: "BROWSER_BUSY",
      message: error.message,
    }
  }
  const step = error instanceof WallapopSoldError ? error.step : "attach"
  const message = error instanceof Error ? error.message : "Error al marcar vendido."
  log("error", "wallapop_sold_http_failed", {
    step,
    message,
    err: serializeError(error),
  })
  return {
    ok: false,
    httpStatus: 500,
    code: "SOLD_FAILED",
    message: `${step}: ${message}`,
  }
}

export async function runWallapopSoldJob(ready: WallapopSoldReady): Promise<void> {
  try {
    const browser = await markWallapopSoldInBrowser({
      itemUrl: ready.itemUrl,
      dryRun: ready.dryRun,
      cdpPort: await chromePortForAccount(ready.accountId),
    })
    if (browser.dryRun) return
    await applyCrmSold(ready)
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (message === "Producto no encontrado." || message === "Product is already sold.") {
      throw error
    }
    throw new Error(mapSoldBrowserError(error).message)
  }
}

async function runPreparedSold(
  prepared: WallapopSoldReady,
  res: Response,
): Promise<void> {
  try {
    const browser = await markWallapopSoldInBrowser({
      itemUrl: prepared.itemUrl,
      dryRun: prepared.dryRun,
      cdpPort: await chromePortForAccount(prepared.accountId),
    })
    if (browser.dryRun) {
      res.json({
        ok: true,
        dryRun: true,
        step: browser.step,
        product: null,
        error: null,
      })
      return
    }
    await persistCrmSold(prepared, res)
  } catch (error) {
    sendPrepareErr(res, mapSoldBrowserError(error))
  }
}

export async function postProductWallapopSold(req: Request, res: Response) {
  const productId = paramId(req)
  if (!productId) {
    sendError(res, 404, "NOT_FOUND", "Producto no encontrado.")
    return
  }
  let body: { dryRun: boolean; soldPrice?: number }
  try {
    body = parseWallapopSoldBody(req)
  } catch (error) {
    if (error instanceof ZodError) {
      sendZod(res, error)
      return
    }
    throw error
  }
  const prepared = await prepareWallapopSold(productId, {
    ...body,
    accountId: readActionAccountId(req.body),
  })
  if (!prepared.ok) {
    sendPrepareErr(res, prepared)
    return
  }
  if (prepared.dryRun) {
    await runPreparedSold(prepared, res)
    return
  }
  const titled = await prepared.prisma.product.findUnique({
    where: { id: prepared.productId },
    select: { title: true },
  })
  const queued = enqueueWorkerJob({
    kind: "sold",
    productId: prepared.productId,
    title: titled?.title ?? "Producto",
    run: () => runWallapopSoldJob(prepared),
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
    product: null,
    error: null,
  })
}
