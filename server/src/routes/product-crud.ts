import type { Prisma } from "../../generated/prisma/client"
import type { Request, Response } from "express"
import { ZodError } from "zod"

import { assertProductCategoryIsLeaf } from "../../../lib/validations/category"
import {
  warehouseProductCreateSchema,
  warehouseProductUpdateSchema,
} from "../../../lib/validations/product"
import {
  DEFAULT_ACCOUNT_MISSING_MESSAGE,
  findDefaultAccountId,
} from "../lib/default-account"
import { getPrisma } from "../lib/db"
import { sendError } from "../lib/http-error"
import { isUniqueConstraint, prismaErrorCode } from "../lib/prisma-error"
import {
  buildListWhere,
  loadProductCard,
  paramId,
  parseListQuery,
  productListInclude,
  sendZod,
  toProductJson,
  toProductListItemJson,
} from "./product-json"

const createBodySchema = warehouseProductCreateSchema.omit({
  soldAt: true,
  soldPrice: true,
})

const updateBodySchema = warehouseProductUpdateSchema
  .omit({
    soldAt: true,
    soldPrice: true,
    status: true,
  })
  .strict()

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
  let query: ReturnType<typeof parseListQuery>
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

type CreateProductBody = ReturnType<typeof createBodySchema.parse>
type PrismaDb = NonNullable<ReturnType<typeof getPrisma>>

function productCreateData(body: CreateProductBody) {
  return {
    sku: body.sku,
    title: body.title,
    description: body.description,
    price: body.price,
    currency: body.currency,
    categoryId: body.categoryId,
    condition: body.condition,
    brand: body.brand,
    weightKg: body.weightKg ?? null,
    shippingPackageSize: body.shippingPackageSize ?? null,
    widthCm: body.widthCm ?? null,
    lengthCm: body.lengthCm ?? null,
    heightCm: body.heightCm ?? null,
    status: body.status,
    typeAttributes: body.typeAttributes as Prisma.InputJsonValue,
  }
}

async function insertProductWithListing(
  prisma: PrismaDb,
  body: CreateProductBody,
  defaultAccountId: string,
) {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.create({ data: productCreateData(body) })
    await tx.productListing.create({
      data: {
        productId: product.id,
        accountId: defaultAccountId,
        status: "READY_TO_POST",
      },
    })
    return product.id
  })
}

function sendCreateProductError(res: Response, error: unknown): boolean {
  if (isUniqueConstraint(error, "sku")) {
    sendError(res, 409, "SKU_TAKEN", "SKU already exists.")
    return true
  }
  if (prismaErrorCode(error) === "P2003") {
    sendError(res, 400, "INVALID_CATEGORY", "Category does not exist.")
    return true
  }
  return false
}

export async function createProduct(req: Request, res: Response) {
  let body: CreateProductBody
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

  const defaultAccountId = await findDefaultAccountId(prisma)
  if (!defaultAccountId) {
    sendError(res, 404, "NOT_FOUND", DEFAULT_ACCOUNT_MISSING_MESSAGE)
    return
  }

  try {
    const created = await insertProductWithListing(prisma, body, defaultAccountId)
    const product = await loadProductCard(prisma, created)
    if (!product) {
      sendError(res, 500, "INTERNAL", "Product was not saved.")
      return
    }
    res.status(201).json({ product: toProductJson(product) })
  } catch (error) {
    if (!sendCreateProductError(res, error)) throw error
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
  const product = await loadProductCard(prisma, id)
  if (!product) {
    sendError(res, 404, "NOT_FOUND", "Product not found.")
    return
  }
  res.json({ product: toProductJson(product) })
}

type UpdateProductBody = ReturnType<typeof updateBodySchema.parse>

function applyProductScalarPatch(
  data: Prisma.ProductUpdateInput,
  body: UpdateProductBody,
) {
  if (body.sku !== undefined) data.sku = body.sku
  if (body.title !== undefined) data.title = body.title
  if (body.description !== undefined) data.description = body.description
  if (body.price !== undefined) data.price = body.price
  if (body.currency !== undefined) data.currency = body.currency
  if (body.condition !== undefined) data.condition = body.condition
  if (body.brand !== undefined) data.brand = body.brand
}

function applyProductMeasurePatch(
  data: Prisma.ProductUpdateInput,
  body: UpdateProductBody,
) {
  if (body.weightKg !== undefined) data.weightKg = body.weightKg
  if (body.shippingPackageSize !== undefined) {
    data.shippingPackageSize = body.shippingPackageSize
  }
  if (body.widthCm !== undefined) data.widthCm = body.widthCm
  if (body.lengthCm !== undefined) data.lengthCm = body.lengthCm
  if (body.heightCm !== undefined) data.heightCm = body.heightCm
}

function buildProductUpdateInput(body: UpdateProductBody): Prisma.ProductUpdateInput {
  const data: Prisma.ProductUpdateInput = {}
  applyProductScalarPatch(data, body)
  applyProductMeasurePatch(data, body)
  if (body.categoryId !== undefined) {
    data.category = { connect: { id: body.categoryId } }
  }
  if (body.typeAttributes !== undefined) {
    data.typeAttributes = body.typeAttributes as Prisma.InputJsonValue
  }
  return data
}

function sendPatchProductError(res: Response, error: unknown): boolean {
  if (prismaErrorCode(error) === "P2025") {
    sendError(res, 404, "NOT_FOUND", "Product not found.")
    return true
  }
  if (isUniqueConstraint(error, "sku")) {
    sendError(res, 409, "SKU_TAKEN", "SKU already exists.")
    return true
  }
  if (prismaErrorCode(error) === "P2003") {
    sendError(res, 400, "INVALID_CATEGORY", "Category does not exist.")
    return true
  }
  return false
}

async function parseUpdateProductBody(req: Request, res: Response) {
  try {
    return updateBodySchema.parse(req.body)
  } catch (error) {
    if (error instanceof ZodError) {
      sendZod(res, error)
      return null
    }
    throw error
  }
}

export async function patchProduct(req: Request, res: Response) {
  const id = paramId(req)
  if (!id) {
    sendError(res, 404, "NOT_FOUND", "Product not found.")
    return
  }
  const body = await parseUpdateProductBody(req, res)
  if (!body) return

  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "Database is not configured.")
    return
  }
  if (body.categoryId && !(await requireLeafCategory(prisma, body.categoryId, res))) {
    return
  }

  try {
    await prisma.product.update({ where: { id }, data: buildProductUpdateInput(body) })
  } catch (error) {
    if (!sendPatchProductError(res, error)) throw error
    return
  }

  const product = await loadProductCard(prisma, id)
  if (!product) {
    sendError(res, 404, "NOT_FOUND", "Product not found.")
    return
  }
  res.json({ product: toProductJson(product) })
}
