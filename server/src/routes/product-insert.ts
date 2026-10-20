import type { Prisma } from "../../generated/prisma/client"
import type { z } from "zod"

import { warehouseProductCreateSchema } from "../../../lib/validations/product"
import { getPrisma } from "../lib/db"
import { readQueueNewProductAllAccounts } from "../lib/queue-new-products"

type PrismaDb = NonNullable<ReturnType<typeof getPrisma>>
type CreateProductBody = z.infer<
  ReturnType<
    typeof warehouseProductCreateSchema.omit<{
      soldAt: true
      soldPrice: true
    }>
  >
>

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

export async function insertProductWithListing(
  prisma: PrismaDb,
  body: CreateProductBody,
  defaultAccountId: string,
) {
  const accountIds = await listingAccountIds(prisma, body, defaultAccountId)
  const productId = await prisma.$transaction(async (tx) => {
    const product = await tx.product.create({ data: productCreateData(body) })
    await tx.productListing.createMany({
      data: accountIds.ids.map((accountId) => ({
        productId: product.id,
        accountId,
        status: "READY_TO_POST" as const,
      })),
    })
    return product.id
  })
  return { productId, autopostAccountIds: accountIds.autopostAccountIds }
}

async function listingAccountIds(
  prisma: PrismaDb,
  body: CreateProductBody,
  defaultAccountId: string,
) {
  const queueAll =
    body.status === "ACTIVE" && (await readQueueNewProductAllAccounts(prisma))
  const accounts = queueAll
    ? await prisma.account.findMany({
        select: { id: true, isDefault: true, autopostEnabled: true },
      })
    : []
  const ids =
    accounts.length > 0 ? accounts.map((account) => account.id) : [defaultAccountId]
  if (!ids.includes(defaultAccountId)) ids.unshift(defaultAccountId)
  return {
    ids,
    autopostAccountIds: accounts
      .filter((account) => account.autopostEnabled && !account.isDefault)
      .map((account) => account.id),
  }
}
