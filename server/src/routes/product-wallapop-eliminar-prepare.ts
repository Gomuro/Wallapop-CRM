import { wallapopEsItemUrlOrNull } from "../../../lib/inventory/wallapop-item-url"
import { getPrisma } from "../lib/db"
import { getWallapopSessionSnapshot } from "../lib/wallapop-session"
import { loadProductCard } from "./product-json"

export type RunWallapopEliminarErr = {
  ok: false
  httpStatus: number
  code: string
  message: string
}

export type WallapopEliminarReady = {
  ok: true
  prisma: NonNullable<ReturnType<typeof getPrisma>>
  productId: string
  accountId: string
  itemUrl: string
  dryRun: boolean
}

function eliminarFail(
  httpStatus: number,
  code: string,
  message: string,
): RunWallapopEliminarErr {
  return { ok: false, httpStatus, code, message }
}

export function isEliminarDryRun(): boolean {
  return process.env.WALLAPOP_ELIMINAR_DRY_RUN !== "false"
}

/** Live on Wallapop (en venta or reserved) with a public es /item/ URL; not sold. */
export function listingForEliminar(
  product: {
    status: string
    listings: { status: string; externalUrl: string | null; accountId: string }[]
  },
  accountId?: string,
): RunWallapopEliminarErr | { itemUrl: string; accountId: string } {
  if (product.status === "SOLD") {
    return eliminarFail(409, "ALREADY_SOLD", "El producto ya está vendido.")
  }
  const listing = accountId
    ? product.listings.find((row) => row.accountId === accountId)
    : product.listings[0]
  if (!listing || (listing.status !== "ACTIVE" && listing.status !== "RESERVED")) {
    return eliminarFail(
      409,
      "LISTING_NOT_ACTIVE",
      "El anuncio no está publicado en Wallapop; no hay nada que eliminar.",
    )
  }
  const itemUrl = wallapopEsItemUrlOrNull(listing.externalUrl)
  if (!itemUrl) {
    return eliminarFail(
      409,
      "NO_ITEM_URL",
      "Falta la URL pública https://es.wallapop.com/item/….",
    )
  }
  return { itemUrl, accountId: listing.accountId }
}

async function guardEliminarSession(
  accountId?: string,
): Promise<RunWallapopEliminarErr | { ok: true }> {
  const session = await getWallapopSessionSnapshot(accountId)
  if (session.status !== "ACTIVE") {
    return eliminarFail(
      409,
      "NOT_ACTIVE",
      "La sesión de Wallapop debe estar activa antes de eliminar el anuncio.",
    )
  }
  return { ok: true }
}

export async function prepareWallapopEliminar(
  productId: string,
  options: { dryRun?: boolean; accountId?: string } = {},
): Promise<RunWallapopEliminarErr | WallapopEliminarReady> {
  const prisma = getPrisma()
  if (!prisma) {
    return eliminarFail(500, "INTERNAL", "La base de datos no está configurada.")
  }
  const product = await loadProductCard(prisma, productId)
  if (!product) {
    return eliminarFail(404, "NOT_FOUND", "Producto no encontrado.")
  }
  const listing = listingForEliminar(product, options.accountId)
  if ("ok" in listing) return listing
  const session = await guardEliminarSession(listing.accountId)
  if (!session.ok) return session
  return {
    ok: true,
    prisma,
    productId,
    accountId: listing.accountId,
    itemUrl: listing.itemUrl,
    dryRun: options.dryRun === true || isEliminarDryRun(),
  }
}
