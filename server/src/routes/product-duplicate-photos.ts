import fs from "node:fs"
import path from "node:path"

import type { Request, Response } from "express"

import { UPLOAD_DIR } from "../../../lib/uploads/config"
import { getPrisma } from "../lib/db"
import { sendError } from "../lib/http-error"
import { duplicatePhotosZip } from "../lib/image-unique/archive"
import { log, serializeError } from "../lib/log"
import { paramId } from "./product-json"

type DuplicatePhotos = { listingId: string; imagePaths: string[] }

async function findDuplicateListing(productId: string, accountId: string) {
  const prisma = getPrisma()
  if (!prisma || !productId || !accountId) return null
  const listing = await prisma.productListing.findUnique({
    where: { productId_accountId: { productId, accountId } },
    select: {
      id: true,
      account: { select: { isDefault: true } },
      product: {
        select: { images: { orderBy: { sortOrder: "asc" }, select: { storageKey: true } } },
      },
    },
  })
  return listing && !listing.account.isDefault ? listing : null
}

/** Same files, same order and same listing id the publish flow gets for this account. */
async function loadDuplicatePhotos(
  req: Request,
  res: Response,
): Promise<DuplicatePhotos | null> {
  const accountId = typeof req.params.accountId === "string" ? req.params.accountId : ""
  const listing = await findDuplicateListing(paramId(req), accountId)
  if (!listing) {
    sendError(res, 404, "NOT_FOUND", "No hay duplicado de este producto en esa cuenta.")
    return null
  }
  const keys = listing.product.images.map((image) => image.storageKey)
  const missing = keys.find((key) => !fs.existsSync(path.join(UPLOAD_DIR, key)))
  if (!keys.length || missing) {
    const detail = missing ? `Falta el archivo de imagen en disco: ${missing}` : "El producto no tiene fotos."
    sendError(res, 400, "VALIDATION_ERROR", detail)
    return null
  }
  return { listingId: listing.id, imagePaths: keys.map((key) => path.join(UPLOAD_DIR, key)) }
}

export async function getDuplicatePhotosZip(req: Request, res: Response) {
  const target = await loadDuplicatePhotos(req, res)
  if (!target) return
  try {
    const zip = await duplicatePhotosZip(target)
    res.setHeader("Content-Type", "application/zip")
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="fotos-duplicado-${target.listingId}.zip"`,
    )
    res.setHeader("Content-Length", String(zip.byteLength))
    res.end(Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength))
  } catch (err) {
    log("error", "duplicate_photos_zip_failed", {
      listingId: target.listingId,
      err: serializeError(err),
    })
    sendError(res, 500, "PHOTOS_FAILED", "No se pudieron preparar las fotos.")
  }
}
