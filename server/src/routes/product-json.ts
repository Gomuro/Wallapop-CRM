import type { Prisma } from "../../generated/prisma/client"
import type { Request, Response } from "express"
import { ZodError } from "zod"

import { isShippingPublishReady } from "../../../lib/inventory/shipping-for-publish"
import {
  listingWithoutPublicItemUrlWhere,
  wallapopItemUrlOrNull,
} from "../../../lib/inventory/wallapop-item-url"
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
    orderBy: { createdAt: "asc" as const },
    select: {
      accountId: true,
      status: true,
      lastPostedAt: true,
      externalUrl: true,
      shippingEnabled: true,
      account: { select: { name: true, isDefault: true } },
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

type ProductJsonIdentity = {
  id: string
  sku: string
  categoryId: string
  status: string
  createdAt: Date
  updatedAt: Date
}

type ProductJsonCopy = {
  title: string
  description: string
  price: { toString(): string }
  currency: string
  condition: string
  brand: string | null
  typeAttributes: unknown
}

type ProductJsonWarehouse = {
  weightKg: { toString(): string } | null
  shippingPackageSize: string | null
  widthCm: { toString(): string } | null
  lengthCm: { toString(): string } | null
  heightCm: { toString(): string } | null
  soldAt: Date | null
  soldPrice: { toString(): string } | null
}

type ProductJsonMedia = {
  images: ProductJsonImage[]
  listings: ProductJsonListing[]
}

type ProductJsonRow = ProductJsonIdentity &
  ProductJsonCopy &
  ProductJsonWarehouse &
  ProductJsonMedia

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

const productDetailListingSelect = {
  ...listingJsonSelect,
  account: { select: { name: true, isDefault: true } },
} as const

export async function loadProductDetail(
  prisma: NonNullable<ReturnType<typeof getPrisma>>,
  id: string,
) {
  return prisma.product.findUnique({
    where: { id },
    include: {
      images: { orderBy: { sortOrder: "asc" as const } },
      listings: {
        orderBy: { createdAt: "asc" as const },
        select: productDetailListingSelect,
      },
    },
  })
}

type ProductDetailListing = ProductJsonListing & {
  account: { name: string; isDefault: boolean }
}

type ProductDetailRow = ProductJsonRow & {
  soldAccountId?: string | null
  listings: ProductDetailListing[]
}

/** `listing` stays the default-account row. `listings` is every row that already exists. */
export function toProductDetailJson(
  row: ProductDetailRow,
  accounts: AccountGlanceSource[] = [],
) {
  const ordered = [...row.listings].sort(
    (a, b) => Number(b.account.isDefault) - Number(a.account.isDefault),
  )
  const defaultListing = ordered.find((item) => item.account.isDefault) ?? null
  return {
    ...toProductJson({
      ...row,
      listings: defaultListing ? [defaultListing] : [],
    }),
    soldAccountId: row.soldAccountId ?? null,
    listings: ordered.map((item) => ({
      ...toListingJson(item),
      accountName: item.account.name,
      isDefault: item.account.isDefault,
    })),
    accounts: accountGlancesForProduct(
      accounts,
      ordered.map((item) => ({
        accountId: item.accountId,
        status: item.status,
        lastPostedAt: item.lastPostedAt,
        externalUrl: item.externalUrl,
        shippingEnabled: item.shippingEnabled,
        account: item.account,
      })),
    ),
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
    listing: firstQueryParam(req.query.listing),
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
  const listing = listingListWhere(query.listing)
  if (listing) where.listings = listing
  return where
}

function listingListWhere(
  listing: ReturnType<typeof productListQuerySchema.parse>["listing"],
): Prisma.ProductWhereInput["listings"] {
  if (!listing) return undefined
  const account = { isDefault: true }
  const onWallapop = { externalUrl: { contains: "/item/" } }
  if (listing === "wallapop") {
    return { some: { account, status: "ACTIVE", ...onWallapop } }
  }
  if (listing === "reserved") {
    return { some: { account, status: "RESERVED", ...onWallapop } }
  }
  if (listing === "queue") {
    return { some: { account, status: "READY_TO_POST" } }
  }
  if (listing === "error") {
    return { some: { account, status: "FAILED" } }
  }
  return {
    some: {
      account,
      status: { in: ["ACTIVE", "RESERVED"] },
      ...listingWithoutPublicItemUrlWhere,
    },
  }
}

type ProductListItemIdentity = {
  id: string
  sku: string
  title: string
  price: { toString(): string }
  currency: string
  status: string
  categoryId: string
  updatedAt: Date
}

type ProductListItemExtras = {
  weightKg: { toString(): string } | null
  widthCm: { toString(): string } | null
  lengthCm: { toString(): string } | null
  heightCm: { toString(): string } | null
  images: Array<{ url: string }>
  listings: Array<{
    accountId: string
    status: string
    lastPostedAt: Date | null
    externalUrl: string | null
    shippingEnabled: boolean
    account?: { name: string; isDefault: boolean } | null
  }>
}

export type AccountGlanceSource = {
  id: string
  name: string
  isDefault: boolean
}

type ProductListItemRow = ProductListItemIdentity & ProductListItemExtras

function defaultListListing(row: ProductListItemRow) {
  return (
    row.listings.find((item) => item.account?.isDefault) ?? row.listings[0] ?? null
  )
}

function toProductListItemListing(row: ProductListItemRow) {
  const listing = defaultListListing(row)
  const listingStatus = listing?.status ?? null
  const live = listingStatus === "ACTIVE" || listingStatus === "RESERVED"
  return {
    listingStatus,
    listingActive:
      live && wallapopItemUrlOrNull(listing?.externalUrl) != null,
    lastPostedAt: listing?.lastPostedAt?.toISOString() ?? null,
    shippingPublishReady: isShippingPublishReady({
      weightKg: decimalJson(row.weightKg),
      shippingEnabled: listing?.shippingEnabled,
    }),
  }
}

export async function loadAccountGlances(
  prisma: NonNullable<ReturnType<typeof getPrisma>>,
): Promise<AccountGlanceSource[]> {
  return prisma.account.findMany({
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true, isDefault: true },
  })
}

export function accountGlancesForProduct(
  accounts: AccountGlanceSource[],
  listings: ProductListItemRow["listings"],
) {
  return accounts.map((account) => {
    const listing = listings.find((item) => item.accountId === account.id)
    return {
      accountId: account.id,
      accountName: account.name,
      isDefault: account.isDefault,
      status: listing?.status ?? null,
      externalUrl: listing?.externalUrl ?? null,
    }
  })
}

export function toProductListItemJson(
  row: ProductListItemRow,
  accounts: AccountGlanceSource[] = [],
) {
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
    accounts: accountGlancesForProduct(accounts, row.listings),
  }
}
