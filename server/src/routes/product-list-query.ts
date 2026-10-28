import type { Prisma } from "../../generated/prisma/client"
import type { Request } from "express"

import { isShippingPublishReady } from "../../../lib/inventory/shipping-for-publish"
import {
  listingWithoutPublicItemUrlWhere,
  wallapopItemUrlOrNull,
} from "../../../lib/inventory/wallapop-item-url"
import { productListQuerySchema } from "../../../lib/validations/product"
import { getPrisma } from "../lib/db"

function decimalJson(value: { toString(): string } | null | undefined) {
  if (value == null) return null
  return Number(value.toString())
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
    // A duplicate waiting for its own text is queued too.
    return { some: { account, status: { in: ["READY_TO_POST", "PREPARING"] } } }
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
    updatedAt?: Date | null
    externalUrl: string | null
    shippingEnabled: boolean
    lastPublishError?: string | null
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
    listingUpdatedAt: listing?.updatedAt?.toISOString() ?? null,
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
      lastPublishError: listing?.lastPublishError ?? null,
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
