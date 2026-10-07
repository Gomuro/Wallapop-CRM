import type { Request, Response } from "express"

import { deleteLocalImage } from "../../../lib/uploads/delete-local-image"
import { saveStrippedImageBuffer } from "../../../lib/uploads/save-stripped-buffer"
import { getPrisma } from "../lib/db"
import { sendError } from "../lib/http-error"
import { prismaErrorCode } from "../lib/prisma-error"
import {
  loadProductCard,
  paramId,
  toProductJson,
} from "./products"

function paramImageId(req: Request) {
  const id = req.params.imageId
  return typeof id === "string" ? id : Array.isArray(id) ? id[0] : ""
}

type PrismaDb = NonNullable<ReturnType<typeof getPrisma>>

async function sendProduct(res: Response, productId: string, status = 200) {
  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "Database is not configured.")
    return
  }
  const product = await loadProductCard(prisma, productId)
  if (!product) {
    sendError(res, 404, "NOT_FOUND", "Product not found.")
    return
  }
  res.status(status).json({ product: toProductJson(product) })
}

async function compactSortOrders(prisma: PrismaDb, productId: string) {
  const remaining = await prisma.productImage.findMany({
    where: { productId },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  })
  await prisma.$transaction(
    remaining.map((image, index) =>
      prisma.productImage.update({
        where: { id: image.id },
        data: { sortOrder: index },
      }),
    ),
  )
}

async function saveReplacementImage(
  file: Express.Multer.File,
  res: Response,
) {
  try {
    return await saveStrippedImageBuffer(
      file.buffer,
      file.mimetype || "application/octet-stream",
    )
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not save image."
    sendError(res, 400, "VALIDATION_ERROR", message)
    return null
  }
}

async function commitReplacementImage(
  prisma: PrismaDb,
  imageId: string,
  saved: Awaited<ReturnType<typeof saveStrippedImageBuffer>>,
  res: Response,
): Promise<boolean> {
  try {
    await prisma.productImage.update({
      where: { id: imageId },
      data: { storageKey: saved.storageKey, url: saved.url },
    })
    return true
  } catch (error) {
    await deleteLocalImage(saved.storageKey)
    if (prismaErrorCode(error) === "P2025") {
      sendError(res, 404, "NOT_FOUND", "Image not found.")
      return false
    }
    throw error
  }
}

export async function putProductImage(req: Request, res: Response) {
  const productId = paramId(req)
  const imageId = paramImageId(req)
  if (!productId || !imageId) {
    sendError(res, 404, "NOT_FOUND", "Image not found.")
    return
  }
  const file = req.file
  if (!file || file.size === 0) {
    sendError(res, 400, "VALIDATION_ERROR", "No image selected.")
    return
  }
  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "Database is not configured.")
    return
  }
  const existing = await prisma.productImage.findFirst({
    where: { id: imageId, productId },
  })
  if (!existing) {
    sendError(res, 404, "NOT_FOUND", "Image not found.")
    return
  }
  const saved = await saveReplacementImage(file, res)
  if (!saved) return
  if (!(await commitReplacementImage(prisma, imageId, saved, res))) return
  await deleteLocalImage(existing.storageKey)
  await sendProduct(res, productId)
}

export async function deleteProductImage(req: Request, res: Response) {
  const productId = paramId(req)
  const imageId = paramImageId(req)
  if (!productId || !imageId) {
    sendError(res, 404, "NOT_FOUND", "Image not found.")
    return
  }

  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "Database is not configured.")
    return
  }

  const existing = await prisma.productImage.findFirst({
    where: { id: imageId, productId },
  })
  if (!existing) {
    sendError(res, 404, "NOT_FOUND", "Image not found.")
    return
  }

  try {
    await prisma.productImage.delete({ where: { id: imageId } })
  } catch (error) {
    if (prismaErrorCode(error) === "P2025") {
      sendError(res, 404, "NOT_FOUND", "Image not found.")
      return
    }
    throw error
  }

  await deleteLocalImage(existing.storageKey)
  await compactSortOrders(prisma, productId)
  await sendProduct(res, productId)
}
