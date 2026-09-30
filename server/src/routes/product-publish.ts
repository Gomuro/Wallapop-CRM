import fs from "node:fs"
import path from "node:path"

import type { PrismaClient } from "../../generated/prisma/client"
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
import { validateShippingForPublish } from "../../../lib/inventory/shipping-for-publish"
import { loadProductCard, paramId } from "./products"

const ALREADY_POSTED_MESSAGE =
  "Este producto ya está publicado o se está publicando en la cuenta predeterminada."

const LIVE_SUCCESS_LISTING_STALE_MESSAGE =
  "Wallapop puede tener ya este artículo. El listing local ya no está en POSTING (no se forzó ACTIVE)."

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

export function listingBlocksDryRun(listing: {
  status: string
  externalUrl: string | null
} | null | undefined): boolean {
  if (!listing) return false
  return listing.status === "ACTIVE" || Boolean(listing.externalUrl)
}

/** Atomic READY_TO_POST → POSTING for (product, account) with no external URL. */
export async function claimListingForPublish(
  prisma: PrismaClient,
  productId: string,
  accountId: string,
): Promise<boolean> {
  const result = await prisma.productListing.updateMany({
    where: {
      productId,
      accountId,
      status: "READY_TO_POST",
      externalUrl: null,
    },
    data: { status: "POSTING" },
  })
  return result.count > 0
}

/** Revert POSTING → READY_TO_POST only. Never touches ACTIVE. */
export async function revertPublishClaim(
  prisma: PrismaClient,
  productId: string,
  accountId: string,
): Promise<void> {
  await prisma.productListing.updateMany({
    where: {
      productId,
      accountId,
      status: "POSTING",
    },
    data: { status: "READY_TO_POST" },
  })
}

/**
 * Revert POSTING → READY_TO_POST only when we claimed and Publicar was never clicked.
 * `postedOnWallapop` is true after live browser success (including click-then-tab-teardown).
 * `clickedPublicar` covers a throw after the click before that success flag is set.
 */
export function shouldRevertPublishClaim(
  claimed: boolean,
  postedOnWallapop: boolean,
  clickedPublicar = false,
): boolean {
  return claimed && !postedOnWallapop && !clickedPublicar
}

/**
 * POSTING → ACTIVE for (product, default account) only.
 * Returns null if 0 rows (e.g. already DEACTIVATED) — never clobbers other statuses.
 */
export async function activatePostingListing(
  prisma: PrismaClient,
  productId: string,
  accountId: string,
  data: {
    externalUrl?: string | null
    shippingEnabled: boolean
  },
): Promise<ReturnType<typeof toListingJson> | null> {
  const result = await prisma.productListing.updateMany({
    where: {
      productId,
      accountId,
      status: "POSTING",
    },
    data: {
      status: "ACTIVE",
      lastPostedAt: new Date(),
      shippingEnabled: data.shippingEnabled,
      ...(data.externalUrl != null ? { externalUrl: data.externalUrl } : {}),
    },
  })
  if (result.count === 0) {
    const current = await prisma.productListing.findUnique({
      where: { productId_accountId: { productId, accountId } },
      select: { status: true, externalUrl: true },
    })
    log("error", "wallapop_publish_listing_not_posting", {
      productId,
      accountId,
      status: current?.status ?? null,
      externalUrl: current?.externalUrl ?? null,
    })
    return null
  }

  const published = await prisma.productListing.findUnique({
    where: { productId_accountId: { productId, accountId } },
    select: listingJsonSelect,
  })
  return published ? toListingJson(published) : null
}

export type RunProductPublishOptions = {
  /** Force dry-run (HTTP body). Env `WALLAPOP_PUBLISH_DRY_RUN !== "false"` still applies. */
  dryRun?: boolean
}

export type RunProductPublishOk = {
  ok: true
  dryRun: boolean
  listing: ReturnType<typeof toListingJson> | null
  step: string
}

export type RunProductPublishErr = {
  ok: false
  httpStatus: number
  code: string
  message: string
}

export type RunProductPublishResult = RunProductPublishOk | RunProductPublishErr

/**
 * Shared live publish path for HTTP `POST …/publish` and the in-process autopost loop.
 * Claim / POSTING stays here so both callers use the same anti-duplicate logic.
 */
export async function runProductPublish(
  productId: string,
  options: RunProductPublishOptions = {},
): Promise<RunProductPublishResult> {
  const prisma = getPrisma()
  if (!prisma) {
    return {
      ok: false,
      httpStatus: 500,
      code: "INTERNAL",
      message: "La base de datos no está configurada.",
    }
  }

  const product = await loadProductCard(prisma, productId)
  if (!product) {
    return {
      ok: false,
      httpStatus: 404,
      code: "NOT_FOUND",
      message: "Producto no encontrado.",
    }
  }

  if (product.status === "SOLD" || product.status === "INACTIVE") {
    return {
      ok: false,
      httpStatus: 409,
      code: "NOT_PUBLISHABLE",
      message:
        "Este producto no se puede publicar porque está vendido o inactivo.",
    }
  }

  const accountId = await findDefaultAccountId(prisma)
  if (!accountId) {
    return {
      ok: false,
      httpStatus: 404,
      code: "NOT_FOUND",
      message: DEFAULT_ACCOUNT_MISSING_MESSAGE,
    }
  }

  const dryRun = options.dryRun === true || isPublishDryRun()
  const listing = product.listings[0]

  if (dryRun) {
    if (listingBlocksDryRun(listing)) {
      return {
        ok: false,
        httpStatus: 409,
        code: "ALREADY_POSTED",
        message: ALREADY_POSTED_MESSAGE,
      }
    }
  } else if (
    !listing ||
    listing.status !== "READY_TO_POST" ||
    listing.externalUrl
  ) {
    return {
      ok: false,
      httpStatus: 409,
      code: "ALREADY_POSTED",
      message: ALREADY_POSTED_MESSAGE,
    }
  }

  if (!product.images.length) {
    return {
      ok: false,
      httpStatus: 400,
      code: "VALIDATION_ERROR",
      message: "El producto necesita al menos una foto antes de publicar.",
    }
  }

  const imagePaths: string[] = []
  for (const image of product.images) {
    const diskPath = path.join(UPLOAD_DIR, image.storageKey)
    if (!fs.existsSync(diskPath)) {
      return {
        ok: false,
        httpStatus: 400,
        code: "VALIDATION_ERROR",
        message: `Falta el archivo de imagen en disco: ${image.storageKey}`,
      }
    }
    imagePaths.push(diskPath)
  }

  const categoryLabels = await categoryBreadcrumbLabelsEs(
    prisma,
    product.categoryId,
    { consumerGoodsPublish: true },
  )
  if (!categoryLabels.length) {
    return {
      ok: false,
      httpStatus: 400,
      code: "VALIDATION_ERROR",
      message:
        "El producto no tiene categoría válida para publicar en Wallapop (path de categoría vacío o desconocido).",
    }
  }

  const shippingEnabled = isPublishShippingEnabled(product)
  const packageType = product.shippingPackageSize ?? "STANDARD"
  const weightKg = decimalToNumberOrNull(product.weightKg)
  const widthCm = decimalToNumberOrNull(product.widthCm)
  const lengthCm = decimalToNumberOrNull(product.lengthCm)
  const heightCm = decimalToNumberOrNull(product.heightCm)

  const shippingReady = validateShippingForPublish({
    weightKg,
    widthCm,
    lengthCm,
    heightCm,
  })
  if (!dryRun && !shippingReady.ok) {
    return {
      ok: false,
      httpStatus: 400,
      code: shippingReady.code,
      message: shippingReady.message,
    }
  }

  if (
    shippingEnabled &&
    packageType !== "BULKY" &&
    weightKg != null &&
    !wallapopStandardWeightBandFromCrm(weightKg)
  ) {
    return {
      ok: false,
      httpStatus: 400,
      code: "VALIDATION_ERROR",
      message:
        "El peso es demasiado alto para envío estándar (máx. 30 kg, incluido el envoltorio).",
    }
  }

  const session = await getWallapopSessionSnapshot()
  if (session.status !== "ACTIVE") {
    return {
      ok: false,
      httpStatus: 409,
      code: "NOT_ACTIVE",
      message:
        "La sesión de Wallapop debe estar activa antes de publicar. Conecta la cuenta primero.",
    }
  }

  let claimed = false
  let postedOnWallapop = false
  let clickedPublicar = false
  if (!dryRun) {
    claimed = await claimListingForPublish(prisma, productId, accountId)
    if (!claimed) {
      return {
        ok: false,
        httpStatus: 409,
        code: "ALREADY_POSTED",
        message: ALREADY_POSTED_MESSAGE,
      }
    }
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
      widthCm,
      lengthCm,
      heightCm,
    })

    if (result.dryRun) {
      return {
        ok: true,
        dryRun: true,
        listing: null,
        step: result.step,
      }
    }

    postedOnWallapop = true
    clickedPublicar = true

    const published = await activatePostingListing(prisma, productId, accountId, {
      externalUrl: result.externalUrl,
      shippingEnabled,
    })
    if (!published) {
      return {
        ok: false,
        httpStatus: 500,
        code: "PUBLISH_FAILED",
        message: LIVE_SUCCESS_LISTING_STALE_MESSAGE,
      }
    }

    return {
      ok: true,
      dryRun: false,
      listing: published,
      step: result.step,
    }
  } catch (error) {
    if (
      error instanceof WallapopPublishError &&
      error.step === "published"
    ) {
      postedOnWallapop = true
      clickedPublicar = true
    }
    if (postedOnWallapop) {
      const message =
        error instanceof Error ? error.message : "Error al guardar el listing."
      log("error", "wallapop_publish_db_after_live_failed", {
        productId,
        accountId,
        message,
      })
      return {
        ok: false,
        httpStatus: 500,
        code: "PUBLISH_FAILED",
        message: `El anuncio puede estar ya en Wallapop. No se pudo guardar ACTIVE: ${message}`,
      }
    }
    if (isBrowserBusyError(error)) {
      return {
        ok: false,
        httpStatus: 409,
        code: "BROWSER_BUSY",
        message: error.message,
      }
    }
    const step = error instanceof WallapopPublishError ? error.step : "attach"
    const message =
      error instanceof Error ? error.message : "Error al publicar."
    log("error", "wallapop_publish_failed", { productId, step, message })
    return {
      ok: false,
      httpStatus: 500,
      code: "PUBLISH_FAILED",
      message: `${step}: ${message}`,
    }
  } finally {
    if (shouldRevertPublishClaim(claimed, postedOnWallapop, clickedPublicar)) {
      try {
        await revertPublishClaim(prisma, productId, accountId)
      } catch (revertError) {
        log("error", "wallapop_publish_claim_revert_failed", {
          productId,
          accountId,
          message:
            revertError instanceof Error
              ? revertError.message
              : String(revertError),
        })
      }
    }
  }
}

export async function publishProduct(req: Request, res: Response) {
  const productId = paramId(req)
  if (!productId) {
    sendError(res, 404, "NOT_FOUND", "Producto no encontrado.")
    return
  }

  const bodyDryRun =
    typeof req.body === "object" &&
    req.body !== null &&
    (req.body as { dryRun?: unknown }).dryRun === true

  const result = await runProductPublish(productId, { dryRun: bodyDryRun })
  if (!result.ok) {
    sendError(res, result.httpStatus, result.code, result.message)
    return
  }

  res.json({
    ok: true,
    dryRun: result.dryRun,
    listing: result.listing,
    error: null,
    step: result.step,
  })
}
