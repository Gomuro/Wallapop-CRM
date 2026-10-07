import type { Request, Response } from "express"
import { ZodError } from "zod"

import { saveStrippedImageBuffer } from "../../../lib/uploads/save-stripped-buffer"
import { productImagesReorderSchema } from "../../../lib/validations/image"
import { PRODUCT_IMAGE_MAX } from "../../../lib/validations/product"
import { getPrisma } from "../lib/db"
import { sendError } from "../lib/http-error"
import {
  loadProductCard,
  paramId,
  toProductJson,
} from "./products"

export { deleteProductImage, putProductImage } from "./product-images-mutate"

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
