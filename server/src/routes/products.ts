import type { Prisma } from "../../generated/prisma/client"
import type { Request, Response } from "express"
import { ZodError } from "zod"

import { assertProductCategoryIsLeaf } from "../../../lib/validations/category"
import {
  productListQuerySchema,
  productSoldBodySchema,
  warehouseProductCreateSchema,
  warehouseProductStatusPatchSchema,
  warehouseProductUpdateSchema,
} from "../../../lib/validations/product"
import { isShippingPublishReady } from "../../../lib/inventory/shipping-for-publish"
import { deleteLocalImage } from "../../../lib/uploads/delete-local-image"
import {
  DEFAULT_ACCOUNT_MISSING_MESSAGE,
  findDefaultAccountId,
} from "../lib/default-account"
import { getPrisma } from "../lib/db"
import { sendError } from "../lib/http-error"
import { listingJsonSelect, toListingJson } from "../lib/listing-json"
import { isUniqueConstraint, prismaErrorCode } from "../lib/prisma-error"

const productListInclude = {
  images: {
    orderBy: { sortOrder: "asc" as const },
    take: 1,
    select: { url: true },
  },
  listings: {
    where: { account: { isDefault: true } },
    orderBy: { createdAt: "asc" as const },
    take: 1,
    select: {
      status: true,
      lastPostedAt: true,
      externalUrl: true,
      shippingEnabled: true,
    },
  },
}

export const productCardInclude = {
  images: { orderBy: { sortOrder: "asc" as const } },
  listings: {
    where: { account: { isDefault: true } },
    orderBy: { createdAt: "asc" as const },
    take: 1,
    select: listingJsonSelect,
  },
}

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

function decimalJson(value: { toString(): string } | null | undefined) {
  if (value == null) return null
  return Number(value.toString())
}

type ProductJsonImage = {
  id: string
  url: string
  storageKey: string
  sortOrder: number
}

type ProductJsonListing = {
  id: string
  status: string
  externalUrl: string | null
  externalItemId: string | null
  shippingEnabled: boolean
  shippingUpToKg: number | null
  accountId: string
  lastPostedAt: Date | null
}

type ProductJsonRow = {
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
  shippingPackageSize: string | null
  widthCm: { toString(): string } | null
  lengthCm: { toString(): string } | null
  heightCm: { toString(): string } | null
  status: string
  typeAttributes: unknown
  soldAt: Date | null
  soldPrice: { toString(): string } | null
  createdAt: Date
  updatedAt: Date
  images: ProductJsonImage[]
  listings: ProductJsonListing[]
}

function toProductJsonCore(row: ProductJsonRow) {
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
  }
}

function toProductJsonMeasures(row: ProductJsonRow) {
  return {
    weightKg: decimalJson(row.weightKg),
    shippingPackageSize: row.shippingPackageSize,
    widthCm: decimalJson(row.widthCm),
    lengthCm: decimalJson(row.lengthCm),
    heightCm: decimalJson(row.heightCm),
  }
}

function toProductJsonRelations(row: ProductJsonRow) {
  return {
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
    listing: row.listings[0] ? toListingJson(row.listings[0]) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toProductJson(row: ProductJsonRow) {
  return {
    ...toProductJsonCore(row),
    ...toProductJsonMeasures(row),
    ...toProductJsonRelations(row),
  }
}

export function paramId(req: Request) {
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

type ProductListItemRow = {
  id: string
  sku: string
  title: string
  price: { toString(): string }
  currency: string
  status: string
  categoryId: string
  updatedAt: Date
  weightKg: { toString(): string } | null
  widthCm: { toString(): string } | null
  lengthCm: { toString(): string } | null
  heightCm: { toString(): string } | null
  images: Array<{ url: string }>
  listings: Array<{
    status: string
    lastPostedAt: Date | null
    externalUrl: string | null
    shippingEnabled: boolean
  }>
}

function toProductListItemListing(row: ProductListItemRow) {
  const listingStatus = row.listings[0]?.status ?? null
  return {
    listingStatus,
    listingActive: listingStatus === "ACTIVE",
    lastPostedAt: row.listings[0]?.lastPostedAt?.toISOString() ?? null,
    shippingPublishReady: isShippingPublishReady({
      weightKg: decimalJson(row.weightKg),
      shippingEnabled: row.listings[0]?.shippingEnabled,
    }),
  }
}

function toProductListItemJson(row: ProductListItemRow) {
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
    ...toProductListItemListing(row),
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

export async function loadProductCard(
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
