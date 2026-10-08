import type { Request, Response } from "express"
import { ZodError } from "zod"

import { productSoldBodySchema } from "../../../lib/validations/product"
import { sendError } from "../lib/http-error"
import { isBrowserBusyError } from "../lib/wallapop-cdp"
import { markProductSoldTx } from "../lib/product-sold"
import { markWallapopSoldInBrowser, WallapopSoldError } from "../lib/wallapop-sold"
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

async function persistCrmSold(ready: WallapopSoldReady, res: Response) {
  const txResult = await markProductSoldTx(ready.prisma, ready.productId, {
    soldPrice: ready.soldPrice,
  })
  if (txResult.kind === "not_found") {
    sendError(res, 404, "NOT_FOUND", "Product not found.")
    return
  }
  if (txResult.kind === "already_sold") {
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
  const prepared = await prepareWallapopSold(productId, body)
  if (!prepared.ok) {
    sendPrepareErr(res, prepared)
    return
  }
  try {
    const browser = await markWallapopSoldInBrowser({
      itemUrl: prepared.itemUrl,
      dryRun: prepared.dryRun,
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
