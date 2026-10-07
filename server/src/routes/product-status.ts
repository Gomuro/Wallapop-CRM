import type { Request, Response } from "express"
import { ZodError } from "zod"

import {
  productSoldBodySchema,
  warehouseProductStatusPatchSchema,
} from "../../../lib/validations/product"
import { deleteLocalImage } from "../../../lib/uploads/delete-local-image"
import { getPrisma } from "../lib/db"
import { sendError } from "../lib/http-error"
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
  res: Response,
): Promise<boolean> {
  const existing = await prisma.product.findUnique({
    where: { id },
    select: { status: true },
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
  if (!(await assertStatusPatchAllowed(prisma, id, res))) return

  try {
    await prisma.product.update({
      where: { id },
      data: { status: body.status },
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

type SoldTxResult =
  | { kind: "not_found" }
  | { kind: "already_sold" }
  | { kind: "ok" }

type SoldBody = ReturnType<typeof productSoldBodySchema.parse>

async function markProductSoldTx(
  prisma: PrismaDb,
  id: string,
  body: SoldBody,
): Promise<SoldTxResult> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.product.findUnique({
      where: { id },
      select: { id: true, status: true, price: true },
    })
    if (!existing) return { kind: "not_found" }
    if (existing.status === "SOLD") return { kind: "already_sold" }
    await tx.product.update({
      where: { id },
      data: {
        status: "SOLD",
        soldAt: new Date(),
        soldPrice: body.soldPrice ?? existing.price,
      },
    })
    await tx.productListing.updateMany({
      where: { productId: id },
      data: { status: "DEACTIVATED" },
    })
    return { kind: "ok" }
  })
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

  let txResult: SoldTxResult
  try {
    txResult = await markProductSoldTx(prisma, id, body)
  } catch (error) {
    if (prismaErrorCode(error) === "P2025") {
      sendError(res, 404, "NOT_FOUND", "Product not found.")
      return
    }
    throw error
  }
  if (sendSoldTxResult(res, txResult)) return

  const product = await loadProductCard(prisma, id)
  if (!product) {
    sendError(res, 404, "NOT_FOUND", "Product not found.")
    return
  }
  res.json({ product: toProductJson(product) })
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
  const existing = await prisma.product.findUnique({
    where: { id },
    select: { images: { select: { storageKey: true } } },
  })
  if (!existing) {
    sendError(res, 404, "NOT_FOUND", "Product not found.")
    return
  }
  try {
    await prisma.product.delete({ where: { id } })
  } catch (error) {
    if (prismaErrorCode(error) === "P2025") {
      sendError(res, 404, "NOT_FOUND", "Product not found.")
      return
    }
    throw error
  }
  for (const image of existing.images) {
    await deleteLocalImage(image.storageKey)
  }
  res.json({ ok: true })
}
