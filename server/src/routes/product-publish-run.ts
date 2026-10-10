import type { PrismaClient } from "../../generated/prisma/client"

import { listingJsonSelect, toListingJson } from "../lib/listing-json"
import { log, serializeError } from "../lib/log"
import { isBrowserBusyError, isPublishAbortedError } from "../lib/wallapop-cdp"
import { publishWallapopInBrowser, WallapopPublishError } from "../lib/wallapop-publish"
import {
  extraUploadFields,
  uploadFieldsFromCategoryAttributes,
  validateExtraUploadFields,
} from "../../../lib/inventory/category-upload-fields"
import { wallapopBrandFromProduct } from "../../../lib/inventory/wallapop-brand"
import { wallapopItemUrlOrNull } from "../../../lib/inventory/wallapop-item-url"
import {
  ALREADY_POSTED_MESSAGE,
  decimalToNumber,
  publishFail,
  type PrismaDb,
  type PublishReady,
  type RunProductPublishErr,
  type RunProductPublishResult,
} from "./product-publish-prepare"
import {
  claimListingForPublish,
  revertPublishClaimIfNeeded,
  type PublishClaimFlags,
} from "./product-publish-claim"

export {
  claimListingForPublish,
  revertPublishClaim,
  shouldRevertPublishClaim,
} from "./product-publish-claim"

const LIVE_SUCCESS_LISTING_STALE_MESSAGE =
  "Wallapop puede tener ya este artículo. El listing local ya no está en POSTING (no se forzó ACTIVE)."
const MISSING_ITEM_URL_MESSAGE =
  "Tras Publicar no se obtuvo el enlace público /item/. El anuncio no se marca En Wallapop."

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
  const itemUrl = wallapopItemUrlOrNull(data.externalUrl ?? null)
  if (!itemUrl) {
    const failed = await prisma.productListing.updateMany({
      where: { productId, accountId, status: "POSTING" },
      data: {
        status: "FAILED",
        externalUrl: null,
        lastPublishError: MISSING_ITEM_URL_MESSAGE,
      },
    })
    if (failed.count === 0) {
      await warnListingNotPosting(prisma, productId, accountId)
      return null
    }
    return loadActivatedListingJson(prisma, productId, accountId)
  }
  const result = await prisma.productListing.updateMany({
    where: { productId, accountId, status: "POSTING" },
    data: postingActivateData({ ...data, externalUrl: itemUrl }),
  })
  if (result.count === 0) {
    await warnListingNotPosting(prisma, productId, accountId)
    return null
  }
  return loadActivatedListingJson(prisma, productId, accountId)
}

export async function claimLivePublish(
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

async function loadCategoryUploadFields(ready: PublishReady) {
  const category = await ready.prisma.category.findUnique({
    where: { id: ready.product.categoryId },
    select: { attributes: true },
  })
  const fields = extraUploadFields(
    uploadFieldsFromCategoryAttributes(category?.attributes),
  )
  const extraErrors = validateExtraUploadFields(
    fields,
    ready.product.typeAttributes,
  )
  const first = Object.values(extraErrors)[0]
  if (first) throw new WallapopPublishError("form", first)
  return fields
}

async function playwrightProductPublish(ready: PublishReady) {
  const uploadFields = await loadCategoryUploadFields(ready)
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
    packageType: ready.packageType === "BULKY" ? "BULKY" : "STANDARD",
    weightKg: ready.weightKg,
    widthCm: ready.widthCm,
    lengthCm: ready.lengthCm,
    heightCm: ready.heightCm,
    typeAttributes: ready.product.typeAttributes,
    uploadFields,
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
  if (published.status !== "ACTIVE") {
    return publishFail(500, "PUBLISH_FAILED", MISSING_ITEM_URL_MESSAGE)
  }
  return { ok: true, dryRun: false, listing: published, step: result.step }
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

export async function executeLivePublish(
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
    return mapPublishCatch(error, productId, prepared.accountId, flags.postedOnWallapop)
  } finally {
    await revertPublishClaimIfNeeded({
      prisma: prepared.prisma,
      productId,
      accountId: prepared.accountId,
      claimed,
      flags,
    })
  }
}
