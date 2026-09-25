import type { Prisma } from "../../generated/prisma/client"
import type { Request, Response } from "express"
import { ZodError } from "zod"

import { assertProductCategoryIsLeaf } from "../../../lib/validations/category"
import {
  productListQuerySchema,
  warehouseProductCreateSchema,
  warehouseProductUpdateSchema,
} from "../../../lib/validations/product"
import { getPrisma } from "../lib/db"
import { sendError } from "../lib/http-error"
import { isUniqueConstraint, prismaErrorCode } from "../lib/prisma-error"

const productListInclude = {
  images: {
    orderBy: { sortOrder: "asc" as const },
    take: 1,
    select: { url: true },
  },
  listings: { select: { status: true } },
}

const productCardInclude = {
  images: { orderBy: { sortOrder: "asc" as const } },
  listings: {
    orderBy: { createdAt: "asc" as const },
    take: 1,
    select: {
      id: true,
      status: true,
      externalUrl: true,
      externalItemId: true,
      shippingEnabled: true,
      shippingUpToKg: true,
      accountId: true,
    },
  },
}

const createBodySchema = warehouseProductCreateSchema.omit({
  soldAt: true,
  soldPrice: true,
})

const updateBodySchema = warehouseProductUpdateSchema.omit({
  soldAt: true,
  soldPrice: true,
})

function decimalJson(value: { toString(): string } | null | undefined) {
  if (value == null) return null
  return Number(value.toString())
}

function toProductJson(row: {
  id: string
  sku: string
  title: string
  description: string
  price: { toString(): string }
  currency: string
  categoryId: string
  condition: string
  brand: string | null
  weightKg: { toString(): string } | null
  status: string
  typeAttributes: unknown
  soldAt: Date | null
  soldPrice: { toString(): string } | null
  createdAt: Date
  updatedAt: Date
  images: Array<{
    id: string
    url: string
    storageKey: string
    sortOrder: number
  }>
  listings: Array<{
    id: string
    status: string
    externalUrl: string | null
    externalItemId: string | null
    shippingEnabled: boolean
    shippingUpToKg: number | null
    accountId: string
  }>
}) {
  return {
    id: row.id,
    sku: row.sku,
    title: row.title,
    description: row.description,
    price: decimalJson(row.price),
    currency: row.currency,
    categoryId: row.categoryId,
    condition: row.condition,
    brand: row.brand,
    weightKg: decimalJson(row.weightKg),
    status: row.status,
    typeAttributes: row.typeAttributes,
    soldAt: row.soldAt?.toISOString() ?? null,
    soldPrice: decimalJson(row.soldPrice),
    images: row.images.map((image) => ({
      id: image.id,
      url: image.url,
      storageKey: image.storageKey,
      sortOrder: image.sortOrder,
    })),
    listing: row.listings[0] ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function paramId(req: Request) {
  const id = req.params.id
  return typeof id === "string" ? id : Array.isArray(id) ? id[0] : ""
}

function firstQueryParam(value: unknown) {
  if (typeof value === "string") return value
  if (Array.isArray(value) && typeof value[0] === "string") return value[0]
  return undefined
}

function parseListQuery(req: Request) {
  return productListQuerySchema.parse({
    page: firstQueryParam(req.query.page),
    pageSize: firstQueryParam(req.query.pageSize),
    status: firstQueryParam(req.query.status),
    q: firstQueryParam(req.query.q),
    categoryId: firstQueryParam(req.query.categoryId),
  })
}

function buildListWhere(
  query: ReturnType<typeof productListQuerySchema.parse>,
): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = {}
  if (query.status !== "ALL") {
    where.status = query.status
  }
  if (query.categoryId) {
    where.categoryId = query.categoryId
  }
  if (query.q) {
    where.OR = [
      { title: { contains: query.q, mode: "insensitive" } },
      { sku: { contains: query.q, mode: "insensitive" } },
    ]
  }
  return where
}

function toProductListItemJson(row: {
  id: string
  sku: string
  title: string
  price: { toString(): string }
  currency: string
  status: string
  categoryId: string
  updatedAt: Date
  images: Array<{ url: string }>
  listings: Array<{ status: string }>
}) {
  return {
    id: row.id,
    sku: row.sku,
    title: row.title,
    price: decimalJson(row.price),
    currency: row.currency,
    status: row.status,
    categoryId: row.categoryId,
    coverUrl: row.images[0]?.url ?? null,
    updatedAt: row.updatedAt.toISOString(),
    listingActive: row.listings.some(
      (listing) => listing.status !== "DEACTIVATED",
    ),
  }
}

function sendZod(res: Response, error: ZodError) {
  sendError(
    res,
    400,
    "VALIDATION_ERROR",
    error.issues[0]?.message ?? "Invalid body.",
  )
}

async function loadCard(
  prisma: NonNullable<ReturnType<typeof getPrisma>>,
  id: string,
) {
  return prisma.product.findUnique({
    where: { id },
    include: productCardInclude,
  })
}

async function requireLeafCategory(
  prisma: NonNullable<ReturnType<typeof getPrisma>>,
  categoryId: string,
  res: Response,
) {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { id: true, isLeaf: true },
  })
  if (!category) {
    sendError(res, 400, "INVALID_CATEGORY", "Category does not exist.")
    return false
  }
  try {
    assertProductCategoryIsLeaf(category)
  } catch {
    sendError(
      res,
      400,
      "INVALID_CATEGORY",
      "products.categoryId must point at a leaf category.",
    )
    return false
  }
  return true
}

export async function listProducts(req: Request, res: Response) {
  let query: ReturnType<typeof productListQuerySchema.parse>
  try {
    query = parseListQuery(req)
  } catch (error) {
    if (error instanceof ZodError) {
      sendZod(res, error)
      return
    }
    throw error
  }

  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "Database is not configured.")
    return
  }

  const where = buildListWhere(query)
  const skip = (query.page - 1) * query.pageSize

  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip,
      take: query.pageSize,
      include: productListInclude,
    }),
  ])

  const totalPages = total === 0 ? 0 : Math.ceil(total / query.pageSize)

  res.json({
    products: rows.map(toProductListItemJson),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages,
  })
}

export async function createProduct(req: Request, res: Response) {
  let body: ReturnType<typeof createBodySchema.parse>
  try {
    body = createBodySchema.parse(req.body)
  } catch (error) {
    if (error instanceof ZodError) {
      sendZod(res, error)
      return
    }
    throw error
  }

  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "Database is not configured.")
    return
  }

  if (!(await requireLeafCategory(prisma, body.categoryId, res))) return

  const account = await prisma.account.findFirst({
    where: { isDefault: true },
    select: { id: true },
  })
  if (!account) {
    sendError(res, 404, "NOT_FOUND", "Default account is not configured.")
    return
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          sku: body.sku,
          title: body.title,
          description: body.description,
          price: body.price,
          currency: body.currency,
          categoryId: body.categoryId,
          condition: body.condition,
          brand: body.brand ?? null,
          weightKg: body.weightKg ?? null,
          status: body.status,
          typeAttributes: body.typeAttributes as Prisma.InputJsonValue,
        },
      })
      await tx.productListing.create({
        data: {
          productId: product.id,
          accountId: account.id,
          status: "READY_TO_POST",
        },
      })
      return product.id
    })
    const product = await loadCard(prisma, created)
    if (!product) {
      sendError(res, 500, "INTERNAL", "Product was not saved.")
      return
    }
    res.status(201).json({ product: toProductJson(product) })
  } catch (error) {
    if (isUniqueConstraint(error, "sku")) {
      sendError(res, 409, "SKU_TAKEN", "SKU already exists.")
      return
    }
    if (prismaErrorCode(error) === "P2003") {
      sendError(res, 400, "INVALID_CATEGORY", "Category does not exist.")
      return
    }
    throw error
  }
}

export async function getProduct(req: Request, res: Response) {
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
  const product = await loadCard(prisma, id)
  if (!product) {
    sendError(res, 404, "NOT_FOUND", "Product not found.")
    return
  }
  res.json({ product: toProductJson(product) })
}

export async function patchProduct(req: Request, res: Response) {
  const id = paramId(req)
  if (!id) {
    sendError(res, 404, "NOT_FOUND", "Product not found.")
    return
  }

  let body: ReturnType<typeof updateBodySchema.parse>
  try {
    body = updateBodySchema.parse(req.body)
  } catch (error) {
    if (error instanceof ZodError) {
      sendZod(res, error)
      return
    }
    throw error
  }

  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "Database is not configured.")
    return
  }

  if (body.categoryId && !(await requireLeafCategory(prisma, body.categoryId, res))) {
    return
  }

  const data: Prisma.ProductUpdateInput = {}
  if (body.sku !== undefined) data.sku = body.sku
  if (body.title !== undefined) data.title = body.title
  if (body.description !== undefined) data.description = body.description
  if (body.price !== undefined) data.price = body.price
  if (body.currency !== undefined) data.currency = body.currency
  if (body.categoryId !== undefined) {
    data.category = { connect: { id: body.categoryId } }
  }
  if (body.condition !== undefined) data.condition = body.condition
  if (body.brand !== undefined) data.brand = body.brand
  if (body.weightKg !== undefined) data.weightKg = body.weightKg
  if (body.status !== undefined) data.status = body.status
  if (body.typeAttributes !== undefined) {
    data.typeAttributes = body.typeAttributes as Prisma.InputJsonValue
  }

  try {
    await prisma.product.update({ where: { id }, data })
  } catch (error) {
    if (prismaErrorCode(error) === "P2025") {
      sendError(res, 404, "NOT_FOUND", "Product not found.")
      return
    }
    if (isUniqueConstraint(error, "sku")) {
      sendError(res, 409, "SKU_TAKEN", "SKU already exists.")
      return
    }
    if (prismaErrorCode(error) === "P2003") {
      sendError(res, 400, "INVALID_CATEGORY", "Category does not exist.")
      return
    }
    throw error
  }

  const product = await loadCard(prisma, id)
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
  try {
    await prisma.product.delete({ where: { id } })
  } catch (error) {
    if (prismaErrorCode(error) === "P2025") {
      sendError(res, 404, "NOT_FOUND", "Product not found.")
      return
    }
    throw error
  }
  res.json({ ok: true })
}
