import type { Request, Response } from "express"

import { catalogDeleteNeedsWallapop } from "../../../lib/inventory/listing-active"
import { wallapopEsItemUrlOrNull } from "../../../lib/inventory/wallapop-item-url"
import { getPrisma } from "../lib/db"
import { sendError } from "../lib/http-error"
import { log, serializeError } from "../lib/log"
import { deactivateListingAfterEliminar } from "../lib/product-eliminar"
import { isBrowserBusyError } from "../lib/wallapop-cdp"
import {
  eliminarWallapopInBrowser,
  WallapopEliminarError,
} from "../lib/wallapop-eliminar"
import { getWallapopSessionSnapshot } from "../lib/wallapop-session"
import { loadProductCard, paramId } from "./product-json"
import { eraseProductIfOffWallapop } from "./product-status"
import { isEliminarDryRun } from "./product-wallapop-eliminar-prepare"

const DRY_RUN_MESSAGE =
  "Prueba: se encontró «Eliminar» en Wallapop y se paró antes de confirmar. El producto sigue en el CRM."

function browserFailure(error: unknown) {
  if (isBrowserBusyError(error)) {
    return { status: 409, code: "BROWSER_BUSY", message: error.message }
  }
  const step = error instanceof WallapopEliminarError ? error.step : "attach"
  const message =
    error instanceof Error ? error.message : "Error al eliminar en Wallapop."
  log("error", "catalog_delete_eliminar_failed", {
    step,
    message,
    err: serializeError(error),
  })
  return { status: 500, code: "ELIMINAR_FAILED", message: `${step}: ${message}` }
}

/** Wallapop first when the ad is still up, then the CRM row. */
export async function postCatalogDelete(req: Request, res: Response) {
  const productId = paramId(req)
  if (!productId) {
    sendError(res, 404, "NOT_FOUND", "Product not found.")
    return
  }
  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "Database is not configured.")
    return
  }
  const product = await loadProductCard(prisma, productId)
  if (!product) {
    sendError(res, 404, "NOT_FOUND", "Product not found.")
    return
  }
  const listing = product.listings[0]
  if (
    catalogDeleteNeedsWallapop({
      status: product.status,
      listing,
    })
  ) {
    const itemUrl = wallapopEsItemUrlOrNull(listing?.externalUrl)
    const session = await getWallapopSessionSnapshot()
    if (!itemUrl || session.status !== "ACTIVE") {
      sendError(
        res,
        409,
        "NOT_ACTIVE",
        "La sesión de Wallapop debe estar activa antes de eliminar el anuncio.",
      )
      return
    }
    try {
      const browser = await eliminarWallapopInBrowser({
        itemUrl,
        dryRun: isEliminarDryRun(),
      })
      if (browser.dryRun) {
        res.json({ ok: true, dryRun: true, deleted: false, error: DRY_RUN_MESSAGE })
        return
      }
    } catch (error) {
      const fail = browserFailure(error)
      sendError(res, fail.status, fail.code, fail.message)
      return
    }
    await deactivateListingAfterEliminar(prisma, productId)
  }
  const erased = await eraseProductIfOffWallapop(prisma, productId)
  if (erased === "not_found") {
    sendError(res, 404, "NOT_FOUND", "Product not found.")
    return
  }
  if (erased === "still_on_wallapop") {
    sendError(
      res,
      409,
      "STILL_ON_WALLAPOP",
      "El anuncio sigue en Wallapop. Primero hay que eliminarlo allí.",
    )
    return
  }
  res.json({ ok: true, dryRun: false, deleted: true, error: null })
}
