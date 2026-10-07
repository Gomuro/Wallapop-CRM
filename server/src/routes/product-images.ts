import type { Request, Response } from "express"
import { ZodError } from "zod"

import { deleteLocalImage } from "../../../lib/uploads/delete-local-image"
import { saveStrippedImageBuffer } from "../../../lib/uploads/save-stripped-buffer"
import { productImagesReorderSchema } from "../../../lib/validations/image"
import { PRODUCT_IMAGE_MAX } from "../../../lib/validations/product"
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

function sendZod(res: Response, error: ZodError) {
  sendError(
    res,
    400,
    "VALIDATION_ERROR",
    error.issues[0]?.message ?? "Invalid body.",
  )
}

function multerFiles(req: Request): Express.Multer.File[] {
  const raw = req.files
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  return []
}

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

async function compactSortOrders(
  prisma: NonNullable<ReturnType<typeof getPrisma>>,
  productId: string,
) {
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

type PrismaDb = NonNullable<ReturnType<typeof getPrisma>>

async function requireExistingProduct(
  prisma: PrismaDb,
  productId: string,
  res: Response,
): Promise<boolean> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  })
  if (!product) {
    sendError(res, 404, "NOT_FOUND", "Product not found.")
    return false
  }
  return true
}

async function assertImageCapacity(
  prisma: PrismaDb,
  productId: string,
  addCount: number,
  res: Response,
): Promise<boolean> {
  const currentCount = await prisma.productImage.count({ where: { productId } })
  if (currentCount + addCount > PRODUCT_IMAGE_MAX) {
    sendError(
      res,
      400,
      "VALIDATION_ERROR",
      `Maximum ${PRODUCT_IMAGE_MAX} photos per product.`,
    )
    return false
  }
  return true
}

async function appendProductImageFiles(
  prisma: PrismaDb,
  productId: string,
  files: Express.Multer.File[],
): Promise<string | null> {
  const last = await prisma.productImage.findFirst({
    where: { productId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  })
  let nextSort = (last?.sortOrder ?? -1) + 1
  try {
    for (const file of files) {
      const saved = await saveStrippedImageBuffer(
        file.buffer,
        file.mimetype || "application/octet-stream",
      )
      await prisma.productImage.create({
        data: {
          productId,
          storageKey: saved.storageKey,
          url: saved.url,
          sortOrder: nextSort,
        },
      })
      nextSort += 1
    }
  } catch (error) {
    return error instanceof Error ? error.message : "Could not save image."
  }
  return null
}

export async function postProductImages(req: Request, res: Response) {
  const productId = paramId(req)
  if (!productId) {
    sendError(res, 404, "NOT_FOUND", "Product not found.")
    return
  }
  const files = multerFiles(req).filter((file) => file.size > 0)
  if (files.length === 0) {
    sendError(res, 400, "VALIDATION_ERROR", "No images selected.")
    return
  }
  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "Database is not configured.")
    return
  }
  if (!(await requireExistingProduct(prisma, productId, res))) return
  if (!(await assertImageCapacity(prisma, productId, files.length, res))) return
  const saveError = await appendProductImageFiles(prisma, productId, files)
  if (saveError) {
    sendError(res, 400, "VALIDATION_ERROR", saveError)
    return
  }
  await sendProduct(res, productId, 201)
}

function reorderIdsError(
  ids: string[],
  images: Array<{ id: string }>,
): string | null {
  if (ids.length !== images.length) {
    return "Reorder must include every image id for this product."
  }
  const known = new Set(images.map((image) => image.id))
  const unique = new Set(ids)
  if (unique.size !== ids.length || ids.some((id) => !known.has(id))) {
    return "Reorder ids must match this product's images."
  }
  return null
}

async function parseReorderBody(req: Request, res: Response) {
  try {
    return productImagesReorderSchema.parse(req.body)
  } catch (error) {
    if (error instanceof ZodError) {
      sendZod(res, error)
      return null
    }
    throw error
  }
}

export async function patchProductImages(req: Request, res: Response) {
  const productId = paramId(req)
  if (!productId) {
    sendError(res, 404, "NOT_FOUND", "Product not found.")
    return
  }
  const body = await parseReorderBody(req, res)
  if (!body) return

  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "Database is not configured.")
    return
  }
  if (!(await requireExistingProduct(prisma, productId, res))) return

  const images = await prisma.productImage.findMany({
    where: { productId },
    select: { id: true },
    orderBy: { sortOrder: "asc" },
  })
  const invalid = reorderIdsError(body.ids, images)
  if (invalid) {
    sendError(res, 400, "VALIDATION_ERROR", invalid)
    return
  }

  await prisma.$transaction(
    body.ids.map((id, sortOrder) =>
      prisma.productImage.update({
        where: { id },
        data: { sortOrder },
      }),
    ),
  )
  await sendProduct(res, productId)
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
