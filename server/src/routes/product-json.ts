import type { Request, Response } from "express"
import { ZodError } from "zod"

import { getPrisma } from "../lib/db"
import { sendError } from "../lib/http-error"
import { listingJsonSelect, toListingJson } from "../lib/listing-json"
import {
  listingVariantSelect,
  toVariantJson,
  type ListingVariantRow,
} from "../lib/listing-variant/json"
import { variantBasis } from "../lib/listing-variant/store"
import {
  accountGlancesForProduct,
  type AccountGlanceSource,
} from "./product-list-query"

export {
  accountGlancesForProduct,
  buildListWhere,
  loadAccountGlances,
  parseListQuery,
  toProductListItemJson,
  type AccountGlanceSource,
} from "./product-list-query"

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
      updatedAt: true,
      externalUrl: true,
      shippingEnabled: true,
      lastPublishError: true,
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
  updatedAt?: Date | null
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
  ...listingVariantSelect,
  lastPublishError: true,
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

type ProductDetailListing = ProductJsonListing &
  ListingVariantRow & {
    account: { name: string; isDefault: boolean }
    lastPublishError: string | null
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
  const basis = variantBasis(row)
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
      variant: item.account.isDefault ? null : toVariantJson(item, basis),
    })),
    accounts: accountGlancesForProduct(
      accounts,
      ordered.map((item) => ({
        accountId: item.accountId,
        status: item.status,
        lastPostedAt: item.lastPostedAt,
        externalUrl: item.externalUrl,
        shippingEnabled: item.shippingEnabled,
        lastPublishError: item.lastPublishError,
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
