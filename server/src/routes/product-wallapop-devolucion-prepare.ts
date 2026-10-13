import {
  productMissingRequiredWallapopBrand,
  WALLAPOP_BRAND_REQUIRED_MESSAGE,
} from "../../../lib/inventory/wallapop-brand"
import { wallapopEsItemUrlOrNull } from "../../../lib/inventory/wallapop-item-url"
import { getPrisma } from "../lib/db"
import { getWallapopSessionSnapshot } from "../lib/wallapop-session"
import { loadProductCard } from "./product-json"
import { isEliminarDryRun } from "./product-wallapop-eliminar-prepare"

export type RunWallapopDevolucionErr = {
  ok: false
  httpStatus: number
  code: string
  message: string
}

export type WallapopDevolucionReady = {
  ok: true
  prisma: NonNullable<ReturnType<typeof getPrisma>>
  productId: string
  itemUrl: string | null
  dryRun: boolean
}

function devolucionFail(
  httpStatus: number,
  code: string,
  message: string,
): RunWallapopDevolucionErr {
  return { ok: false, httpStatus, code, message }
}

/** Sold warehouse; optional public /item/ URL to Eliminar before re-queue. */
export function listingForDevolucion(product: {
  status: string
  listings: { status: string; externalUrl: string | null }[]
}): RunWallapopDevolucionErr | { itemUrl: string | null } {
  if (product.status !== "SOLD") {
    return devolucionFail(409, "NOT_SOLD", "El producto no está vendido.")
  }
  const listing = product.listings[0]
  if (listing?.status === "POSTING") {
    return devolucionFail(
      409,
      "PUBLISH_IN_PROGRESS",
      "Listing is being published. Mark as ACTIVE to recover, or omit status to update the URL only.",
    )
  }
  return {
    itemUrl: listing ? wallapopEsItemUrlOrNull(listing.externalUrl) : null,
  }
}

async function guardDevolucionSession(): Promise<
  RunWallapopDevolucionErr | { ok: true }
> {
  const session = await getWallapopSessionSnapshot()
  if (session.status !== "ACTIVE") {
    return devolucionFail(
      409,
      "NOT_ACTIVE",
      "La sesión de Wallapop debe estar activa antes de eliminar el anuncio.",
    )
  }
  return { ok: true }
}

async function rejectDevolucionWithoutBrand(
  prisma: NonNullable<ReturnType<typeof getPrisma>>,
  productId: string,
): Promise<RunWallapopDevolucionErr | { ok: true }> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      brand: true,
      description: true,
      typeAttributes: true,
      category: { select: { attributes: true } },
    },
  })
  if (
    !product ||
    !productMissingRequiredWallapopBrand({
      brand: product.brand,
      description: product.description,
      typeAttributes: product.typeAttributes,
      categoryAttributes: product.category.attributes,
    })
  ) {
    return { ok: true }
  }
  return devolucionFail(400, "BRAND_REQUIRED", WALLAPOP_BRAND_REQUIRED_MESSAGE)
}

export async function prepareWallapopDevolucion(
  productId: string,
  options: { dryRun?: boolean } = {},
): Promise<RunWallapopDevolucionErr | WallapopDevolucionReady> {
  const prisma = getPrisma()
  if (!prisma) {
    return devolucionFail(500, "INTERNAL", "La base de datos no está configurada.")
  }
  const product = await loadProductCard(prisma, productId)
  if (!product) {
    return devolucionFail(404, "NOT_FOUND", "Producto no encontrado.")
  }
  const listing = listingForDevolucion(product)
  if ("ok" in listing) return listing
  const brand = await rejectDevolucionWithoutBrand(prisma, productId)
  if (!brand.ok) return brand
  if (listing.itemUrl) {
    const session = await guardDevolucionSession()
    if (!session.ok) return session
  }
  return {
    ok: true,
    prisma,
    productId,
    itemUrl: listing.itemUrl,
    dryRun: listing.itemUrl != null && (options.dryRun === true || isEliminarDryRun()),
  }
}
