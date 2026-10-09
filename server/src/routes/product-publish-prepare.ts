import fs from "node:fs"
import path from "node:path"

import { UPLOAD_DIR } from "../../../lib/uploads/config"
import {
  DEFAULT_ACCOUNT_MISSING_MESSAGE,
  findDefaultAccountId,
} from "../lib/default-account"
import { getPrisma } from "../lib/db"
import { toListingJson } from "../lib/listing-json"
import { getWallapopSessionSnapshot } from "../lib/wallapop-session"
import { wallapopStandardWeightBandFromCrm } from "../lib/wallapop-weight-band"
import { categoryBreadcrumbLabelsEs } from "../lib/category-breadcrumb"
import { validateShippingForPublish } from "../../../lib/inventory/shipping-for-publish"
import { wallapopBrandFromProduct } from "../../../lib/inventory/wallapop-brand"
import { wallapopItemUrlOrNull } from "../../../lib/inventory/wallapop-item-url"
import { loadProductCard } from "./products"

export const ALREADY_POSTED_MESSAGE =
  "Este producto ya está publicado o se está publicando en la cuenta predeterminada."

function isPublishDryRun(): boolean {
  return process.env.WALLAPOP_PUBLISH_DRY_RUN !== "false"
}

export function decimalToNumber(value: { toString(): string } | number): number {
  return typeof value === "number" ? value : Number(value.toString())
}

function decimalToNumberOrNull(
  value: { toString(): string } | number | null | undefined,
): number | null {
  if (value == null) return null
  const n = decimalToNumber(value)
  return Number.isFinite(n) ? n : null
}

function isPublishShippingEnabled(_product: {
  shippingPackageSize: string | null
  listings: { shippingEnabled: boolean }[]
}): boolean {
  return true
}

export function listingBlocksDryRun(
  listing: { status: string; externalUrl: string | null } | null | undefined,
): boolean {
  if (!listing) return false
  return (
    listing.status === "ACTIVE" ||
    listing.status === "RESERVED" ||
    wallapopItemUrlOrNull(listing.externalUrl) != null
  )
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
export type PrismaDb = NonNullable<ReturnType<typeof getPrisma>>
export type ProductCard = NonNullable<Awaited<ReturnType<typeof loadProductCard>>>

export type PublishReady = {
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

export function publishFail(httpStatus: number, code: string, message: string): RunProductPublishErr {
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
  return !listing || listing.status !== "READY_TO_POST" || wallapopItemUrlOrNull(listing.externalUrl) != null
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

type PublishShipping = Pick<
  PublishReady,
  | "categoryLabels"
  | "shippingEnabled"
  | "packageType"
  | "weightKg"
  | "widthCm"
  | "lengthCm"
  | "heightCm"
>

function weightBandInvalid(shippingEnabled: boolean, packageType: string, weightKg: number | null) {
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

export async function prepareProductPublish(
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
