import fs from "node:fs"
import path from "node:path"

import type { Request, Response } from "express"

import { UPLOAD_DIR } from "../../../lib/uploads/config"
import {
  DEFAULT_ACCOUNT_MISSING_MESSAGE,
  findDefaultAccountId,
} from "../lib/default-account"
import { getPrisma } from "../lib/db"
import { sendError } from "../lib/http-error"
import { listingJsonSelect, toListingJson } from "../lib/listing-json"
import { log } from "../lib/log"
import { getWallapopSessionSnapshot } from "../lib/wallapop-session"
import { isBrowserBusyError } from "../lib/wallapop-cdp"
import {
  publishWallapopInBrowser,
  WallapopPublishError,
} from "../lib/wallapop-publish"
import { wallapopStandardWeightBandFromCrm } from "../lib/wallapop-weight-band"
import { categoryBreadcrumbLabelsEs } from "../lib/category-breadcrumb"
import { loadProductCard, paramId } from "./products"

function isPublishDryRun(): boolean {
  return process.env.WALLAPOP_PUBLISH_DRY_RUN !== "false"
}

function decimalToNumber(value: { toString(): string } | number): number {
  if (typeof value === "number") return value
  return Number(value.toString())
}

function decimalToNumberOrNull(
  value: { toString(): string } | number | null | undefined,
): number | null {
  if (value == null) return null
  const n = decimalToNumber(value)
  return Number.isFinite(n) ? n : null
}

function isPublishShippingEnabled(product: {
  shippingPackageSize: string | null
  listings: { shippingEnabled: boolean }[]
}): boolean {
  const listing = product.listings[0]
  if (listing?.shippingEnabled === true) return true
  if (listing?.shippingEnabled === false) return false
  return true
}

export async function publishProduct(req: Request, res: Response) {
  const productId = paramId(req)
  if (!productId) {
    sendError(res, 404, "NOT_FOUND", "Producto no encontrado.")
    return
  }

  const session = await getWallapopSessionSnapshot()
  if (session.status !== "ACTIVE") {
    sendError(
      res,
      409,
      "NOT_ACTIVE",
      "La sesión de Wallapop debe estar activa antes de publicar. Conecta la cuenta primero.",
    )
    return
  }

  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "La base de datos no está configurada.")
    return
  }

  const product = await loadProductCard(prisma, productId)
  if (!product) {
    sendError(res, 404, "NOT_FOUND", "Producto no encontrado.")
    return
  }

  if (!product.images.length) {
    sendError(
      res,
      400,
      "VALIDATION_ERROR",
      "El producto necesita al menos una foto antes de publicar.",
    )
    return
  }

  const imagePaths: string[] = []
  for (const image of product.images) {
    const diskPath = path.join(UPLOAD_DIR, image.storageKey)
    if (!fs.existsSync(diskPath)) {
      sendError(
        res,
        400,
        "VALIDATION_ERROR",
        `Falta el archivo de imagen en disco: ${image.storageKey}`,
      )
      return
    }
    imagePaths.push(diskPath)
  }

  const bodyDryRun =
    typeof req.body === "object" &&
    req.body !== null &&
    (req.body as { dryRun?: unknown }).dryRun === true
  const dryRun = bodyDryRun || isPublishDryRun()

  const categoryLabels = await categoryBreadcrumbLabelsEs(
    prisma,
    product.categoryId,
    { consumerGoodsPublish: true },
  )
  if (!categoryLabels.length) {
    sendError(
      res,
      400,
      "VALIDATION_ERROR",
      "El producto no tiene categoría válida para publicar en Wallapop (path de categoría vacío o desconocido).",
    )
    return
  }

  const shippingEnabled = isPublishShippingEnabled(product)
  const packageType = product.shippingPackageSize ?? "STANDARD"
  const weightKg = decimalToNumberOrNull(product.weightKg)

  if (shippingEnabled && weightKg == null) {
    sendError(
      res,
      400,
      "VALIDATION_ERROR",
      "Indica el peso del producto antes de publicar con envío.",
    )
    return
  }

  if (
    shippingEnabled &&
    packageType !== "BULKY" &&
    weightKg != null &&
    !wallapopStandardWeightBandFromCrm(weightKg)
  ) {
    sendError(
      res,
      400,
      "VALIDATION_ERROR",
      "El peso es demasiado alto para envío estándar (máx. 30 kg, incluido el envoltorio).",
    )
    return
  }

  try {
    const result = await publishWallapopInBrowser({
      title: product.title,
      description: product.description,
      price: decimalToNumber(product.price),
      condition: product.condition,
      brand: product.brand,
      imagePaths,
      categoryLabels,
      dryRun,
      shippingEnabled,
      packageType,
      weightKg,
      widthCm: decimalToNumberOrNull(product.widthCm),
      lengthCm: decimalToNumberOrNull(product.lengthCm),
      heightCm: decimalToNumberOrNull(product.heightCm),
    })

    if (result.dryRun) {
      res.json({
        ok: true,
        dryRun: true,
        listing: null,
        error: null,
        step: result.step,
      })
      return
    }

    const accountId = await findDefaultAccountId(prisma)
    if (!accountId) {
      sendError(res, 404, "NOT_FOUND", DEFAULT_ACCOUNT_MISSING_MESSAGE)
      return
    }

    const listing = await prisma.productListing.upsert({
      where: {
        productId_accountId: { productId, accountId },
      },
      update: {
        status: "ACTIVE",
        externalUrl: result.externalUrl ?? undefined,
        lastPostedAt: new Date(),
        shippingEnabled,
      },
      create: {
        productId,
        accountId,
        status: "ACTIVE",
        externalUrl: result.externalUrl ?? null,
        shippingEnabled,
        lastPostedAt: new Date(),
      },
      select: listingJsonSelect,
    })

    res.json({
      ok: true,
      dryRun: false,
      listing: toListingJson(listing),
      error: null,
      step: result.step,
    })
  } catch (error) {
    if (isBrowserBusyError(error)) {
      sendError(res, 409, "BROWSER_BUSY", error.message)
      return
    }
    const step = error instanceof WallapopPublishError ? error.step : "attach"
    const message =
      error instanceof Error ? error.message : "Error al publicar."
    log("error", "wallapop_publish_failed", { productId, step, message })
    sendError(res, 500, "PUBLISH_FAILED", `${step}: ${message}`)
  }
}
