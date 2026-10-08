import { wallapopEsItemUrlOrNull } from "../../../lib/inventory/wallapop-item-url"
import { getPrisma } from "../lib/db"
import { getWallapopSessionSnapshot } from "../lib/wallapop-session"
import { loadProductCard } from "./product-json"

export type RunWallapopSoldErr = {
  ok: false
  httpStatus: number
  code: string
  message: string
}

export type WallapopSoldReady = {
  ok: true
  prisma: NonNullable<ReturnType<typeof getPrisma>>
  productId: string
  itemUrl: string
  dryRun: boolean
  soldPrice?: number
}

function soldFail(
  httpStatus: number,
  code: string,
  message: string,
): RunWallapopSoldErr {
  return { ok: false, httpStatus, code, message }
}

export function isSoldDryRun(): boolean {
  return process.env.WALLAPOP_SOLD_DRY_RUN !== "false"
}

export function listingForSold(product: {
  status: string
  listings: { status: string; externalUrl: string | null }[]
}): RunWallapopSoldErr | { itemUrl: string } {
  if (product.status === "SOLD") {
    return soldFail(409, "ALREADY_SOLD", "Product is already sold.")
  }
  const listing = product.listings[0]
  if (!listing || listing.status !== "ACTIVE") {
    return soldFail(
      409,
      "LISTING_NOT_ACTIVE",
      "El anuncio no está ACTIVE; no se puede marcar vendido en Wallapop.",
    )
  }
  const itemUrl = wallapopEsItemUrlOrNull(listing.externalUrl)
  if (!itemUrl) {
    return soldFail(
      409,
      "NO_ITEM_URL",
      "Falta la URL pública https://es.wallapop.com/item/….",
    )
  }
  return { itemUrl }
}

async function guardSoldSession(): Promise<RunWallapopSoldErr | { ok: true }> {
  const session = await getWallapopSessionSnapshot()
  if (session.status !== "ACTIVE") {
    return soldFail(
      409,
      "NOT_ACTIVE",
      "La sesión de Wallapop debe estar activa antes de marcar vendido.",
    )
  }
  return { ok: true }
}

export async function prepareWallapopSold(
  productId: string,
  options: { dryRun?: boolean; soldPrice?: number } = {},
): Promise<RunWallapopSoldErr | WallapopSoldReady> {
  const prisma = getPrisma()
  if (!prisma) {
    return soldFail(500, "INTERNAL", "La base de datos no está configurada.")
  }
  const product = await loadProductCard(prisma, productId)
  if (!product) {
    return soldFail(404, "NOT_FOUND", "Producto no encontrado.")
  }
  const listing = listingForSold(product)
  if ("ok" in listing) return listing
  const session = await guardSoldSession()
  if (!session.ok) return session
  return {
    ok: true,
    prisma,
    productId,
    itemUrl: listing.itemUrl,
    dryRun: options.dryRun === true || isSoldDryRun(),
    soldPrice: options.soldPrice,
  }
}
