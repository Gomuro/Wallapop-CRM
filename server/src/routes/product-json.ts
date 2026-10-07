import type { Prisma } from "../../generated/prisma/client"
import type { Request, Response } from "express"
import { ZodError } from "zod"

import { isShippingPublishReady } from "../../../lib/inventory/shipping-for-publish"
import { productListQuerySchema } from "../../../lib/validations/product"
import { getPrisma } from "../lib/db"
import { sendError } from "../lib/http-error"
import { listingJsonSelect, toListingJson } from "../lib/listing-json"

export const productListInclude = {
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

export async function loadProductCard(
  prisma: NonNullable<ReturnType<typeof getPrisma>>,
  id: string,
) {
  return prisma.product.findUnique({
    where: { id },
    include: productCardInclude,
  })
}

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

export function sendZod(res: Response, error: ZodError) {
  sendError(
    res,
    400,
    "VALIDATION_ERROR",
    error.issues[0]?.message ?? "Invalid body.",
  )
}

function firstQueryParam(value: unknown) {
  if (typeof value === "string") return value
  if (Array.isArray(value) && typeof value[0] === "string") return value[0]
  return undefined
}

export function parseListQuery(req: Request) {
  return productListQuerySchema.parse({
    page: firstQueryParam(req.query.page),
    pageSize: firstQueryParam(req.query.pageSize),
    status: firstQueryParam(req.query.status),
    q: firstQueryParam(req.query.q),
    categoryId: firstQueryParam(req.query.categoryId),
  })
}

export function buildListWhere(
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

export function toProductListItemJson(row: ProductListItemRow) {
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
