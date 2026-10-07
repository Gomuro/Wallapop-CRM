import type { Prisma, PrismaClient } from "../generated/prisma/client"

import { targetCategoryId, wallapopIdToCategoryId } from "./remap"

const listingSelect = {
  id: true,
  status: true,
  externalUrl: true,
  externalItemId: true,
  shippingEnabled: true,
  shippingUpToKg: true,
  lastPostedAt: true,
  lastEditedAt: true,
} as const

const productInclude = {
  category: { select: { wallapopId: true } },
  images: { orderBy: { sortOrder: "asc" as const } },
  listings: { select: listingSelect },
} satisfies Prisma.ProductInclude

export type WarehouseProduct = Prisma.ProductGetPayload<{
  include: typeof productInclude
}>

export async function loadWarehouse(
  prisma: PrismaClient,
): Promise<WarehouseProduct[]> {
  return prisma.product.findMany({
    include: productInclude,
    orderBy: { sku: "asc" },
  })
}

export async function defaultAccountId(prisma: PrismaClient): Promise<string> {
  const account = await prisma.account.findFirst({
    where: { isDefault: true },
    select: { id: true },
  })
  if (!account) throw new Error("No default account on the target database.")
  return account.id
}

export async function categoryMap(
  prisma: PrismaClient,
): Promise<Map<number, string>> {
  const rows = await prisma.category.findMany({
    select: { id: true, wallapopId: true },
  })
  return wallapopIdToCategoryId(rows)
}

type ProductWrite = {
  title: string
  description: string
  price: WarehouseProduct["price"]
  currency: string
  categoryId: string
  condition: WarehouseProduct["condition"]
  brand: string | null
  weightKg: WarehouseProduct["weightKg"]
  shippingPackageSize: WarehouseProduct["shippingPackageSize"]
  widthCm: WarehouseProduct["widthCm"]
  lengthCm: WarehouseProduct["lengthCm"]
  heightCm: WarehouseProduct["heightCm"]
  status: WarehouseProduct["status"]
  typeAttributes: Prisma.InputJsonValue
  soldAt: Date | null
  soldPrice: WarehouseProduct["soldPrice"]
}

function productWrite(
  row: WarehouseProduct,
  categoryId: string,
): ProductWrite {
  return {
    title: row.title,
    description: row.description,
    price: row.price,
    currency: row.currency,
    categoryId,
    condition: row.condition,
    brand: row.brand,
    weightKg: row.weightKg,
    shippingPackageSize: row.shippingPackageSize,
    widthCm: row.widthCm,
    lengthCm: row.lengthCm,
    heightCm: row.heightCm,
    status: row.status,
    typeAttributes: row.typeAttributes as Prisma.InputJsonValue,
    soldAt: row.soldAt,
    soldPrice: row.soldPrice,
  }
}

async function replaceImages(
  prisma: PrismaClient,
  productId: string,
  images: WarehouseProduct["images"],
): Promise<void> {
  await prisma.productImage.deleteMany({ where: { productId } })
  if (!images.length) return
  await prisma.productImage.createMany({
    data: images.map((image) => ({
      productId,
      storageKey: image.storageKey,
      url: image.url,
      sortOrder: image.sortOrder,
    })),
  })
}

function listingWrite(
  row: WarehouseProduct["listings"][number],
  productId: string,
  accountId: string,
) {
  return {
    productId,
    accountId,
    status: row.status,
    externalUrl: row.externalUrl,
    externalItemId: row.externalItemId,
    shippingEnabled: row.shippingEnabled,
    shippingUpToKg: row.shippingUpToKg,
    lastPostedAt: row.lastPostedAt,
    lastEditedAt: row.lastEditedAt,
  }
}

async function upsertListing(
  prisma: PrismaClient,
  productId: string,
  accountId: string,
  listing: WarehouseProduct["listings"][number],
): Promise<void> {
  const data = listingWrite(listing, productId, accountId)
  await prisma.productListing.upsert({
    where: { productId_accountId: { productId, accountId } },
    create: data,
    update: data,
  })
}

export type ApplyReport = {
  upserted: string[]
  skipped: { sku: string; reason: string }[]
}

export async function applyWarehouse(options: {
  prisma: PrismaClient
  products: WarehouseProduct[]
  dryRun: boolean
  muteAutopost: boolean
}): Promise<ApplyReport> {
  const byWallapopId = await categoryMap(options.prisma)
  const accountId = await defaultAccountId(options.prisma)
  const report: ApplyReport = { upserted: [], skipped: [] }

  for (const row of options.products) {
    const categoryId = targetCategoryId(row.category.wallapopId, byWallapopId)
    if (!categoryId) {
      report.skipped.push({
        sku: row.sku,
        reason: `no category wallapop_id=${row.category.wallapopId}`,
      })
      continue
    }
    report.upserted.push(row.sku)
    if (options.dryRun) continue
    const data = productWrite(row, categoryId)
    const saved = await options.prisma.product.upsert({
      where: { sku: row.sku },
      create: { sku: row.sku, ...data },
      update: data,
    })
    await replaceImages(options.prisma, saved.id, row.images)
    const listing = row.listings[0]
    if (listing) await upsertListing(options.prisma, saved.id, accountId, listing)
  }

  if (options.muteAutopost && !options.dryRun) {
    await options.prisma.account.updateMany({
      where: { isDefault: true },
      data: { autopostEnabled: false },
    })
  }
  return report
}

export async function listingBySku(
  prisma: PrismaClient,
  sku: string,
) {
  const product = await prisma.product.findUnique({
    where: { sku },
    include: {
      listings: { select: listingSelect },
    },
  })
  if (!product) return null
  return { product, listing: product.listings[0] ?? null }
}
