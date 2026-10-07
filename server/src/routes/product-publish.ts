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
import { log, serializeError } from "../lib/log"
import { getWallapopSessionSnapshot } from "../lib/wallapop-session"
import { isBrowserBusyError, isPublishAbortedError } from "../lib/wallapop-cdp"
import {
  publishWallapopInBrowser,
  WallapopPublishError,
} from "../lib/wallapop-publish"
import { wallapopStandardWeightBandFromCrm } from "../lib/wallapop-weight-band"
import { categoryBreadcrumbLabelsEs } from "../lib/category-breadcrumb"
import { validateShippingForPublish } from "../../../lib/inventory/shipping-for-publish"
import { wallapopBrandFromProduct } from "../../../lib/inventory/wallapop-brand"
import {
  listingWithoutPublicItemUrlWhere,
  wallapopItemUrlOrNull,
} from "../../../lib/inventory/wallapop-item-url"
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
  return product.listings[0]?.shippingEnabled !== false
}

export function listingBlocksDryRun(listing: {
  status: string
  externalUrl: string | null
} | null | undefined): boolean {
  if (!listing) return false
  return listing.status === "ACTIVE" || wallapopItemUrlOrNull(listing.externalUrl) != null
}

/** Atomic READY_TO_POST → POSTING for (product, account) without a public item URL. */
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
      ...listingWithoutPublicItemUrlWhere,
    },
    data: {
      status: "POSTING",
      externalUrl: null,
      postingAttempts: { increment: 1 },
      lastPublishError: null,
    },
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
 * `postedOnWallapop` is true after D9 verified the published catalog (or /item/).
 * `clickedPublicar` / `keepClaim`: click ran but verify failed — stay POSTING, not ACTIVE.
 */
export function shouldRevertPublishClaim(
  claimed: boolean,
  postedOnWallapop: boolean,
  clickedPublicar = false,
): boolean {
  return claimed && !postedOnWallapop && !clickedPublicar
}

async function warnListingNotPosting(
  prisma: PrismaClient,
  productId: string,
  accountId: string,
): Promise<void> {
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
}

async function loadActivatedListingJson(
  prisma: PrismaClient,
  productId: string,
  accountId: string,
): Promise<ReturnType<typeof toListingJson> | null> {
  const published = await prisma.productListing.findUnique({
    where: { productId_accountId: { productId, accountId } },
    select: listingJsonSelect,
  })
  return published ? toListingJson(published) : null
}

function postingActivateData(data: {
  externalUrl?: string | null
  shippingEnabled: boolean
}) {
  return {
    status: "ACTIVE" as const,
    lastPostedAt: new Date(),
    shippingEnabled: data.shippingEnabled,
    postingAttempts: 0,
    lastPublishError: null,
    externalUrl: wallapopItemUrlOrNull(data.externalUrl ?? null),
  }
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
    where: { productId, accountId, status: "POSTING" },
    data: postingActivateData(data),
  })
  if (result.count === 0) {
    await warnListingNotPosting(prisma, productId, accountId)
    return null
  }
  return loadActivatedListingJson(prisma, productId, accountId)
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

type PrismaDb = NonNullable<ReturnType<typeof getPrisma>>
type ProductCard = NonNullable<Awaited<ReturnType<typeof loadProductCard>>>

type PublishReady = {
  ok: true
  prisma: PrismaDb
  product: ProductCard
  accountId: string
  dryRun: boolean
  imagePaths: string[]
  categoryLabels: string[]
  shippingEnabled: boolean
  packageType: string
  weightKg: number | null
  widthCm: number | null
  lengthCm: number | null
  heightCm: number | null
}

function publishFail(
  httpStatus: number,
  code: string,
  message: string,
): RunProductPublishErr {
  return { ok: false, httpStatus, code, message }
}

async function loadPublishProduct(
  productId: string,
): Promise<RunProductPublishErr | { ok: true; prisma: PrismaDb; product: ProductCard }> {
  const prisma = getPrisma()
  if (!prisma) {
    return publishFail(500, "INTERNAL", "La base de datos no está configurada.")
  }
  const product = await loadProductCard(prisma, productId)
  if (!product) {
    return publishFail(404, "NOT_FOUND", "Producto no encontrado.")
  }
  if (product.status === "SOLD" || product.status === "INACTIVE") {
    return publishFail(
      409,
      "NOT_PUBLISHABLE",
      "Este producto no se puede publicar porque está vendido o inactivo.",
    )
  }
  return { ok: true, prisma, product }
}

function listingBlocksLivePublish(listing: ProductCard["listings"][number] | undefined) {
  return (
    !listing ||
    listing.status !== "READY_TO_POST" ||
    wallapopItemUrlOrNull(listing.externalUrl) != null
  )
}

async function guardPublishAccountAndListing(
  prisma: PrismaDb,
  product: ProductCard,
  dryRun: boolean,
): Promise<RunProductPublishErr | { ok: true; accountId: string }> {
  const accountId = await findDefaultAccountId(prisma)
  if (!accountId) {
    return publishFail(404, "NOT_FOUND", DEFAULT_ACCOUNT_MISSING_MESSAGE)
  }
  const listing = product.listings[0]
  const blocked = dryRun
    ? listingBlocksDryRun(listing)
    : listingBlocksLivePublish(listing)
  if (blocked) {
    return publishFail(409, "ALREADY_POSTED", ALREADY_POSTED_MESSAGE)
  }
  return { ok: true, accountId }
}

function resolvePublishImages(
  product: ProductCard,
): RunProductPublishErr | { ok: true; imagePaths: string[] } {
  if (!product.images.length) {
    return publishFail(
      400,
      "VALIDATION_ERROR",
      "El producto necesita al menos una foto antes de publicar.",
    )
  }
  if (
    !wallapopBrandFromProduct({
      brand: product.brand,
      description: product.description,
      typeAttributes: product.typeAttributes,
    })
  ) {
    return publishFail(
      400,
      "BRAND_REQUIRED",
      "Introduce una marca. Wallapop no deja publicar el anuncio sin Marca.",
    )
  }
  const imagePaths: string[] = []
  for (const image of product.images) {
    const diskPath = path.join(UPLOAD_DIR, image.storageKey)
    if (!fs.existsSync(diskPath)) {
      return publishFail(
        400,
        "VALIDATION_ERROR",
        `Falta el archivo de imagen en disco: ${image.storageKey}`,
      )
    }
    imagePaths.push(diskPath)
  }
  return { ok: true, imagePaths }
}

type PublishShipping = {
  categoryLabels: string[]
  shippingEnabled: boolean
  packageType: string
  weightKg: number | null
  widthCm: number | null
  lengthCm: number | null
  heightCm: number | null
}

function weightBandInvalid(
  shippingEnabled: boolean,
  packageType: string,
  weightKg: number | null,
) {
  return (
    shippingEnabled &&
    packageType !== "BULKY" &&
    weightKg != null &&
    !wallapopStandardWeightBandFromCrm(weightKg)
  )
}

function publishShippingMeasures(product: ProductCard): PublishShipping {
  const shippingEnabled = isPublishShippingEnabled(product)
  return {
    categoryLabels: [],
    shippingEnabled,
    packageType: product.shippingPackageSize ?? "STANDARD",
    weightKg: decimalToNumberOrNull(product.weightKg),
    widthCm: decimalToNumberOrNull(product.widthCm),
    lengthCm: decimalToNumberOrNull(product.lengthCm),
    heightCm: decimalToNumberOrNull(product.heightCm),
  }
}

function guardPublishShippingReady(
  dryRun: boolean,
  measures: PublishShipping,
): RunProductPublishErr | null {
  const shippingReady = validateShippingForPublish({
    weightKg: measures.weightKg,
    shippingEnabled: measures.shippingEnabled,
  })
  if (!dryRun && !shippingReady.ok) {
    return publishFail(400, shippingReady.code, shippingReady.message)
  }
  if (weightBandInvalid(measures.shippingEnabled, measures.packageType, measures.weightKg)) {
    return publishFail(
      400,
      "VALIDATION_ERROR",
      "El peso es demasiado alto para envío estándar (máx. 30 kg, incluido el envoltorio).",
    )
  }
  return null
}

async function resolvePublishShipping(
  prisma: PrismaDb,
  product: ProductCard,
  dryRun: boolean,
): Promise<RunProductPublishErr | ({ ok: true } & PublishShipping)> {
  const categoryLabels = await categoryBreadcrumbLabelsEs(
    prisma,
    product.categoryId,
    { consumerGoodsPublish: true },
  )
  if (!categoryLabels.length) {
    return publishFail(
      400,
      "VALIDATION_ERROR",
      "El producto no tiene categoría válida para publicar en Wallapop (path de categoría vacío o desconocido).",
    )
  }
  const measures = { ...publishShippingMeasures(product), categoryLabels }
  const blocked = guardPublishShippingReady(dryRun, measures)
  if (blocked) return blocked
  return { ok: true, ...measures }
}

async function guardPublishSession(): Promise<RunProductPublishErr | { ok: true }> {
  const session = await getWallapopSessionSnapshot()
  if (session.status !== "ACTIVE") {
    return publishFail(
      409,
      "NOT_ACTIVE",
      "La sesión de Wallapop debe estar activa antes de publicar. Conecta la cuenta primero.",
    )
  }
  return { ok: true }
}

async function prepareProductPublish(
  productId: string,
  options: RunProductPublishOptions,
): Promise<RunProductPublishErr | PublishReady> {
  const loaded = await loadPublishProduct(productId)
  if (!loaded.ok) return loaded
  const dryRun = options.dryRun === true || isPublishDryRun()
  const account = await guardPublishAccountAndListing(
    loaded.prisma,
    loaded.product,
    dryRun,
  )
  if (!account.ok) return account
  const assets = resolvePublishImages(loaded.product)
  if (!assets.ok) return assets
  const shipping = await resolvePublishShipping(loaded.prisma, loaded.product, dryRun)
  if (!shipping.ok) return shipping
  const session = await guardPublishSession()
  if (!session.ok) return session
  return {
    ok: true,
    prisma: loaded.prisma,
    product: loaded.product,
    accountId: account.accountId,
    dryRun,
    imagePaths: assets.imagePaths,
    categoryLabels: shipping.categoryLabels,
    shippingEnabled: shipping.shippingEnabled,
    packageType: shipping.packageType,
    weightKg: shipping.weightKg,
    widthCm: shipping.widthCm,
    lengthCm: shipping.lengthCm,
    heightCm: shipping.heightCm,
  }
}

async function claimLivePublish(
  prisma: PrismaDb,
  productId: string,
  accountId: string,
  dryRun: boolean,
): Promise<RunProductPublishErr | { ok: true; claimed: boolean }> {
  if (dryRun) return { ok: true, claimed: false }
  const claimed = await claimListingForPublish(prisma, productId, accountId)
  if (!claimed) {
    return publishFail(409, "ALREADY_POSTED", ALREADY_POSTED_MESSAGE)
  }
  return { ok: true, claimed: true }
}

async function playwrightProductPublish(ready: PublishReady) {
  return publishWallapopInBrowser({
    title: ready.product.title,
    description: ready.product.description,
    price: decimalToNumber(ready.product.price),
    condition: ready.product.condition,
    brand: wallapopBrandFromProduct({
      brand: ready.product.brand,
      description: ready.product.description,
      typeAttributes: ready.product.typeAttributes,
    }),
    imagePaths: ready.imagePaths,
    categoryLabels: ready.categoryLabels,
    dryRun: ready.dryRun,
    shippingEnabled: ready.shippingEnabled,
    packageType: ready.packageType,
    weightKg: ready.weightKg,
    widthCm: ready.widthCm,
    lengthCm: ready.lengthCm,
    heightCm: ready.heightCm,
  })
}

async function verifyProductPublish(
  ready: PublishReady,
  result: Awaited<ReturnType<typeof publishWallapopInBrowser>>,
): Promise<RunProductPublishResult> {
  if (result.dryRun) {
    return { ok: true, dryRun: true, listing: null, step: result.step }
  }
  const published = await activatePostingListing(
    ready.prisma,
    ready.product.id,
    ready.accountId,
    { externalUrl: result.externalUrl, shippingEnabled: ready.shippingEnabled },
  )
  if (!published) {
    return publishFail(500, "PUBLISH_FAILED", LIVE_SUCCESS_LISTING_STALE_MESSAGE)
  }
  return { ok: true, dryRun: false, listing: published, step: result.step }
}

type PublishClaimFlags = {
  postedOnWallapop: boolean
  clickedPublicar: boolean
}

function applyPublishErrorFlags(error: unknown, flags: PublishClaimFlags) {
  if (error instanceof WallapopPublishError && error.step === "published") {
    flags.postedOnWallapop = true
    flags.clickedPublicar = true
  }
  if (error instanceof WallapopPublishError && error.keepClaim) {
    flags.clickedPublicar = true
  }
}

function mapPostedOnWallapopDbFail(
  error: unknown,
  productId: string,
  accountId: string,
): RunProductPublishErr {
  const message =
    error instanceof Error ? error.message : "Error al guardar el listing."
  log("error", "wallapop_publish_db_after_live_failed", {
    productId,
    accountId,
    message,
  })
  return publishFail(
    500,
    "PUBLISH_FAILED",
    `El anuncio puede estar ya en Wallapop. No se pudo guardar ACTIVE: ${message}`,
  )
}

function mapPublishCatch(
  error: unknown,
  productId: string,
  accountId: string,
  postedOnWallapop: boolean,
): RunProductPublishErr {
  if (postedOnWallapop) {
    return mapPostedOnWallapopDbFail(error, productId, accountId)
  }
  if (isBrowserBusyError(error)) {
    return publishFail(409, "BROWSER_BUSY", error.message)
  }
  if (isPublishAbortedError(error)) {
    log("info", "wallapop_publish_aborted_by_stop", {
      productId,
      message: error.message,
    })
    return publishFail(409, "PUBLISH_ABORTED", error.message)
  }
  const step = error instanceof WallapopPublishError ? error.step : "attach"
  const message = error instanceof Error ? error.message : "Error al publicar."
  log("error", "wallapop_publish_failed", {
    productId,
    step,
    message,
    err: serializeError(error),
  })
  return publishFail(500, "PUBLISH_FAILED", `${step}: ${message}`)
}

async function revertPublishClaimIfNeeded(
  prisma: PrismaDb,
  productId: string,
  accountId: string,
  claimed: boolean,
  flags: PublishClaimFlags,
): Promise<void> {
  if (!shouldRevertPublishClaim(claimed, flags.postedOnWallapop, flags.clickedPublicar)) {
    return
  }
  try {
    await revertPublishClaim(prisma, productId, accountId)
  } catch (revertError) {
    log("error", "wallapop_publish_claim_revert_failed", {
      productId,
      accountId,
      message:
        revertError instanceof Error ? revertError.message : String(revertError),
    })
  }
}

async function executeLivePublish(
  prepared: PublishReady,
  productId: string,
  claimed: boolean,
): Promise<RunProductPublishResult> {
  const flags: PublishClaimFlags = {
    postedOnWallapop: false,
    clickedPublicar: false,
  }
  try {
    const result = await playwrightProductPublish(prepared)
    if (!result.dryRun) {
      flags.postedOnWallapop = true
      flags.clickedPublicar = true
    }
    return await verifyProductPublish(prepared, result)
  } catch (error) {
    applyPublishErrorFlags(error, flags)
    return mapPublishCatch(
      error,
      productId,
      prepared.accountId,
      flags.postedOnWallapop,
    )
  } finally {
    await revertPublishClaimIfNeeded(
      prepared.prisma,
      productId,
      prepared.accountId,
      claimed,
      flags,
    )
  }
}

/**
 * Shared live publish path for HTTP `POST …/publish` and the in-process autopost loop.
 * Claim / POSTING stays here so both callers use the same anti-duplicate logic.
 */
export async function runProductPublish(
  productId: string,
  options: RunProductPublishOptions = {},
): Promise<RunProductPublishResult> {
  const prepared = await prepareProductPublish(productId, options)
  if (!prepared.ok) return prepared
  const claim = await claimLivePublish(
    prepared.prisma,
    productId,
    prepared.accountId,
    prepared.dryRun,
  )
  if (!claim.ok) return claim
  return executeLivePublish(prepared, productId, claim.claimed)
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
