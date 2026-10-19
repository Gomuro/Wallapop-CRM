import type { Request, Response } from "express"
import { ZodError } from "zod"

import {
  productSoldBodySchema,
  warehouseProductStatusPatchSchema,
} from "../../../lib/validations/product"
import { deleteLocalImage } from "../../../lib/uploads/delete-local-image"
import { getPrisma } from "../lib/db"
import { sendError } from "../lib/http-error"
import {
  catalogDeleteNeedsWallapop,
  listingBlocksWarehouseInactive,
} from "../../../lib/inventory/listing-active"
import { findDefaultAccountId, DEFAULT_ACCOUNT_MISSING_MESSAGE } from "../lib/default-account"
import { markProductSoldTx, type SoldTxResult } from "../lib/product-sold"
import { scheduleSiblingSold } from "../lib/sibling-eliminar"
import { dequeueInactiveWarehouseQueue } from "../lib/warehouse-inactive"
import { prismaErrorCode } from "../lib/prisma-error"
import { loadProductCard, paramId, sendZod, toProductJson } from "./product-json"

type PrismaDb = NonNullable<ReturnType<typeof getPrisma>>

async function parseStatusPatchBody(req: Request, res: Response) {
  try {
    return warehouseProductStatusPatchSchema.parse(req.body)
  } catch (error) {
    if (error instanceof ZodError) {
      sendZod(res, error)
      return null
    }
    throw error
  }
}

async function assertStatusPatchAllowed(
  prisma: PrismaDb,
  id: string,
  body: { status: "ACTIVE" | "INACTIVE" },
  res: Response,
): Promise<boolean> {
  const existing = await prisma.product.findUnique({
    where: { id },
    select: {
      status: true,
      listings: {
        where: { account: { isDefault: true } },
        take: 1,
        select: { status: true, externalUrl: true },
      },
    },
  })
  if (!existing) {
    sendError(res, 404, "NOT_FOUND", "Product not found.")
    return false
  }
  if (existing.status === "SOLD") {
    sendError(
      res,
      409,
      "PRODUCT_SOLD",
      "Sold products cannot change warehouse status.",
    )
    return false
  }
  if (
    body.status === "INACTIVE" &&
    listingBlocksWarehouseInactive(existing.listings[0])
  ) {
    sendError(
      res,
      409,
      "LIVE_ON_WALLAPOP",
      "Quita el anuncio de Wallapop antes de marcarlo inactivo.",
    )
    return false
  }
  return true
}

export async function patchProductStatus(req: Request, res: Response) {
  const id = paramId(req)
  if (!id) {
    sendError(res, 404, "NOT_FOUND", "Product not found.")
    return
  }
  const body = await parseStatusPatchBody(req, res)
  if (!body) return

  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "Database is not configured.")
    return
  }
  if (!(await assertStatusPatchAllowed(prisma, id, body, res))) return

  try {
    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: { status: body.status },
      })
      if (body.status !== "INACTIVE") return
      await dequeueInactiveWarehouseQueue(tx, id)
    })
  } catch (error) {
    if (prismaErrorCode(error) === "P2025") {
      sendError(res, 404, "NOT_FOUND", "Product not found.")
      return
    }
    throw error
  }

  const product = await loadProductCard(prisma, id)
  if (!product) {
    sendError(res, 404, "NOT_FOUND", "Product not found.")
    return
  }
  res.json({ product: toProductJson(product) })
}

function sendSoldTxResult(res: Response, txResult: SoldTxResult): boolean {
  if (txResult.kind === "not_found") {
    sendError(res, 404, "NOT_FOUND", "Product not found.")
    return true
  }
  if (txResult.kind === "already_sold") {
    sendError(res, 409, "ALREADY_SOLD", "Product is already sold.")
    return true
  }
  return false
}

async function parseSoldBody(req: Request, res: Response) {
  try {
    return productSoldBodySchema.parse(req.body ?? {})
  } catch (error) {
    if (error instanceof ZodError) {
      sendZod(res, error)
      return null
    }
    throw error
  }
}

export async function postProductSold(req: Request, res: Response) {
  const id = paramId(req)
  if (!id) {
    sendError(res, 404, "NOT_FOUND", "Product not found.")
    return
  }
  const body = await parseSoldBody(req, res)
  if (!body) return

  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "Database is not configured.")
    return
  }

  const accountId = await findDefaultAccountId(prisma)
  if (!accountId) {
    sendError(res, 404, "NOT_FOUND", DEFAULT_ACCOUNT_MISSING_MESSAGE)
    return
  }

  let txResult: SoldTxResult
  try {
    txResult = await markProductSoldTx(prisma, id, { ...body, accountId })
  } catch (error) {
    if (prismaErrorCode(error) === "P2025") {
      sendError(res, 404, "NOT_FOUND", "Product not found.")
      return
    }
    throw error
  }
  if (sendSoldTxResult(res, txResult)) return
  void scheduleSiblingSold(id, accountId)

  const product = await loadProductCard(prisma, id)
  if (!product) {
    sendError(res, 404, "NOT_FOUND", "Product not found.")
    return
  }
  res.json({ product: toProductJson(product) })
}

const STILL_ON_WALLAPOP =
  "El anuncio sigue en Wallapop. Primero hay que eliminarlo allí."

export async function eraseProductIfOffWallapop(
  prisma: PrismaDb,
  id: string,
): Promise<"not_found" | "still_on_wallapop" | "deleted"> {
  const existing = await prisma.product.findUnique({
    where: { id },
    select: {
      status: true,
      images: { select: { storageKey: true } },
      listings: {
        where: { account: { isDefault: true } },
        select: { status: true, externalUrl: true },
        take: 1,
      },
    },
  })
  if (!existing) return "not_found"
  if (
    catalogDeleteNeedsWallapop({
      status: existing.status,
      listing: existing.listings[0],
    })
  ) {
    return "still_on_wallapop"
  }
  try {
    await prisma.product.delete({ where: { id } })
  } catch (error) {
    if (prismaErrorCode(error) === "P2025") return "not_found"
    throw error
  }
  for (const image of existing.images) {
    await deleteLocalImage(image.storageKey)
  }
  return "deleted"
}

export async function deleteProduct(req: Request, res: Response) {
  const id = paramId(req)
  if (!id) {
    sendError(res, 404, "NOT_FOUND", "Product not found.")
    return
  }
  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "Database is not configured.")
    return
  }
  const result = await eraseProductIfOffWallapop(prisma, id)
  if (result === "not_found") {
    sendError(res, 404, "NOT_FOUND", "Product not found.")
    return
  }
  if (result === "still_on_wallapop") {
    sendError(res, 409, "STILL_ON_WALLAPOP", STILL_ON_WALLAPOP)
    return
  }
  res.json({ ok: true })
}
