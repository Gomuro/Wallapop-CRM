import "server-only"

import type { Prisma } from "@/lib/generated/prisma/client"
import { getPrisma } from "@/lib/db"
import {
  memoryCountProductsByStatus,
  memoryCreateProduct,
  memoryDeleteProduct,
  memoryGetProduct,
  memoryListProducts,
  memoryMarkProductSold,
  memoryUpdateProduct,
} from "@/lib/inventory/memory"
import type { ProductCreateInput, ProductUpdateInput } from "@/lib/validations"
import type {
  InventoryProduct,
  MarkSoldResult,
  ProductListQuery,
  StatusCounts,
} from "@/lib/inventory/types"

const productInclude = {
  listings: {
    include: { account: true },
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.ProductInclude

type ProductWithListings = Prisma.ProductGetPayload<{
  include: typeof productInclude
}>

const CONNECTION_CODES = new Set([
  "P1000",
  "P1001",
  "P1002",
  "P1003",
  "P1008",
  "P1009",
  "P1010",
  "P1011",
  "P1017",
])

const globalForStore = globalThis as unknown as {
  wallapopUseMemory?: boolean
}

function isDbUnavailable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  if (
    "code" in error &&
    typeof error.code === "string" &&
    CONNECTION_CODES.has(error.code)
  ) {
    return true
  }
  const message =
    "message" in error && typeof error.message === "string" ? error.message : ""
  if (
    /authentication failed|can't reach database|econnrefused|enotfound|connection refused|connection terminated/i.test(
      message,
    )
  ) {
    return true
  }
  if ("cause" in error) return isDbUnavailable(error.cause)
  return false
}

function enableMemoryFallback() {
  if (!globalForStore.wallapopUseMemory) {
    console.warn("[inventory] database unavailable, using in-memory mock")
  }
  globalForStore.wallapopUseMemory = true
}

async function withStore<T>(
  dbFn: (
    prisma: NonNullable<ReturnType<typeof getPrisma>>,
  ) => Promise<T>,
  memoryFn: () => T,
): Promise<T> {
  if (globalForStore.wallapopUseMemory) return memoryFn()

  const prisma = getPrisma()
  if (!prisma) {
    enableMemoryFallback()
    return memoryFn()
  }

  try {
    return await dbFn(prisma)
  } catch (error) {
    if (isDbUnavailable(error)) {
      enableMemoryFallback()
      return memoryFn()
    }
    throw error
  }
}

function toInventoryProduct(row: ProductWithListings): InventoryProduct {
  return {
    id: row.id,
    sku: row.sku,
    title: row.title,
    description: row.description,
    price: row.price,
    category: row.category,
    condition: row.condition,
    weight: row.weight,
    images: row.images,
    status: row.status,
    externalLinks: row.externalLinks,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    listings: row.listings.map((listing) => ({
      id: listing.id,
      accountId: listing.accountId,
      accountName: listing.account.name,
      externalUrl: listing.externalUrl,
      status: listing.status,
    })),
  }
}

function isNotFoundError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2025"
  )
}

function productSearchWhere(q: string): Prisma.ProductWhereInput {
  if (!q) return {}
  return {
    OR: [
      { title: { contains: q, mode: "insensitive" } },
      { sku: { contains: q, mode: "insensitive" } },
    ],
  }
}

export async function listProducts(
  query: ProductListQuery = {},
): Promise<InventoryProduct[]> {
  const status = query.status ?? "ALL"
  const q = query.q?.trim() ?? ""

  return withStore(async (prisma) => {
    const where: Prisma.ProductWhereInput = {
      ...productSearchWhere(q),
      ...(status !== "ALL" ? { status } : {}),
    }

    const rows = await prisma.product.findMany({
      where,
      include: productInclude,
      orderBy: { updatedAt: "desc" },
    })

    return rows.map(toInventoryProduct)
  }, () => memoryListProducts({ q, status }))
}

export async function countProductsByStatus(
  q?: string,
): Promise<StatusCounts> {
  const query = q?.trim() ?? ""

  return withStore(async (prisma) => {
    const grouped = await prisma.product.groupBy({
      by: ["status"],
      where: productSearchWhere(query),
      _count: { _all: true },
    })

    const counts: StatusCounts = { ALL: 0, ACTIVE: 0, SOLD: 0, INACTIVE: 0 }
    for (const row of grouped) {
      counts[row.status] = row._count._all
      counts.ALL += row._count._all
    }
    return counts
  }, () => memoryCountProductsByStatus(query))
}

export async function getProduct(id: string): Promise<InventoryProduct | null> {
  return withStore(async (prisma) => {
    const row = await prisma.product.findUnique({
      where: { id },
      include: productInclude,
    })
    return row ? toInventoryProduct(row) : null
  }, () => memoryGetProduct(id))
}

export async function createProduct(
  input: ProductCreateInput,
): Promise<InventoryProduct> {
  return withStore(async (prisma) => {
    const row = await prisma.product.create({
      data: {
        sku: input.sku,
        title: input.title,
        description: input.description,
        price: input.price,
        category: input.category,
        condition: input.condition,
        weight: input.weight ?? null,
        images: input.images ?? [],
        status: input.status ?? "ACTIVE",
        externalLinks: input.externalLinks ?? [],
      },
      include: productInclude,
    })
    return toInventoryProduct(row)
  }, () => memoryCreateProduct(input))
}

export async function updateProduct(
  id: string,
  input: ProductUpdateInput,
): Promise<InventoryProduct | null> {
  return withStore(async (prisma) => {
    try {
      const row = await prisma.$transaction(async (tx) => {
        if (input.status === "SOLD") {
          await tx.productListing.updateMany({
            where: { productId: id },
            data: { status: "DEACTIVATED" },
          })
        }

        return tx.product.update({
          where: { id },
          data: {
            ...(input.sku !== undefined ? { sku: input.sku } : {}),
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.description !== undefined
              ? { description: input.description }
              : {}),
            ...(input.price !== undefined ? { price: input.price } : {}),
            ...(input.category !== undefined ? { category: input.category } : {}),
            ...(input.condition !== undefined
              ? { condition: input.condition }
              : {}),
            ...(input.weight !== undefined
              ? { weight: input.weight ?? null }
              : {}),
            ...(input.images !== undefined ? { images: input.images } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
            ...(input.externalLinks !== undefined
              ? { externalLinks: input.externalLinks }
              : {}),
          },
          include: productInclude,
        })
      })
      return toInventoryProduct(row)
    } catch (error) {
      if (isNotFoundError(error)) return null
      throw error
    }
  }, () => memoryUpdateProduct(id, input))
}

export async function deleteProduct(id: string): Promise<boolean> {
  return withStore(async (prisma) => {
    try {
      await prisma.product.delete({ where: { id } })
      return true
    } catch (error) {
      if (isNotFoundError(error)) return false
      throw error
    }
  }, () => memoryDeleteProduct(id))
}

export async function markProductSold(id: string): Promise<MarkSoldResult> {
  return withStore(async (prisma) => {
    return prisma.$transaction(async (tx) => {
      const flipped = await tx.product.updateMany({
        where: { id, status: { not: "SOLD" } },
        data: { status: "SOLD" },
      })

      if (flipped.count === 0) {
        const existing = await tx.product.findUnique({
          where: { id },
          select: { id: true },
        })
        return {
          ok: false as const,
          reason: existing ? ("already-sold" as const) : ("not-found" as const),
        }
      }

      await tx.productListing.updateMany({
        where: { productId: id },
        data: { status: "DEACTIVATED" },
      })

      const row = await tx.product.findUniqueOrThrow({
        where: { id },
        include: productInclude,
      })
      return { ok: true as const, product: toInventoryProduct(row) }
    })
  }, () => memoryMarkProductSold(id))
}
