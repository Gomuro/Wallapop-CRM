import type { Request, Response } from "express"

import { getPrisma } from "../lib/db"
import { sendError } from "../lib/http-error"
import { listingJsonSelect, toListingJson } from "../lib/listing-json"
import { rescheduleAutopostLoop, scheduleAccountAutopost } from "../lib/wallapop-autopost"
import { listingBlocksManualQueue, rejectReadyToPostWithoutBrand } from "./product-listings"
import { paramId } from "./products"

const QUEUE_LISTING_DATA = {
  status: "READY_TO_POST" as const,
  externalUrl: null,
  externalItemId: null,
  postingAttempts: 0,
  lastPublishError: null,
}

type PrismaDb = NonNullable<ReturnType<typeof getPrisma>>

async function loadQueuePair(prisma: PrismaDb, productId: string, accountId: string, res: Response) {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { id: true, isDefault: true, autopostEnabled: true },
  })
  if (!account) {
    sendError(res, 404, "NOT_FOUND", "Cuenta no encontrada.")
    return null
  }
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, status: true },
  })
  if (!product) {
    sendError(res, 404, "NOT_FOUND", "Producto no encontrado.")
    return null
  }
  if (product.status === "INACTIVE") {
    sendError(res, 409, "NOT_PUBLISHABLE", "Este producto no se puede publicar porque está inactivo.")
    return null
  }
  return { account, product }
}

async function writeQueuedListing(
  prisma: PrismaDb,
  productId: string,
  accountId: string,
  productStatus: string,
) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.productListing.upsert({
      where: { productId_accountId: { productId, accountId } },
      create: {
        product: { connect: { id: productId } },
        account: { connect: { id: accountId } },
        ...QUEUE_LISTING_DATA,
        shippingEnabled: true,
      },
      update: QUEUE_LISTING_DATA,
      select: listingJsonSelect,
    })
    await reactivateWarehouse(tx, productId, productStatus)
    return row
  })
}

async function reactivateWarehouse(
  tx: Parameters<Parameters<PrismaDb["$transaction"]>[0]>[0],
  productId: string,
  productStatus: string,
) {
  if (productStatus === "SOLD") {
    await tx.product.update({
      where: { id: productId },
      data: { status: "ACTIVE", soldAt: null, soldPrice: null, soldAccountId: null },
    })
    return
  }
  await tx.product.updateMany({
    where: { id: productId, status: { not: "SOLD" } },
    data: { status: "ACTIVE" },
  })
}

function queueIds(req: Request) {
  const productId = paramId(req)
  const accountId = typeof req.body?.accountId === "string" ? req.body.accountId.trim() : ""
  if (!productId || !accountId) return null
  return { productId, accountId }
}

export async function queueProductOnAccount(req: Request, res: Response) {
  const ids = queueIds(req)
  if (!ids) {
    sendError(res, 400, "VALIDATION_ERROR", "Falta la cuenta.")
    return
  }
  const { productId, accountId } = ids
  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "Database is not configured.")
    return
  }
  const pair = await loadQueuePair(prisma, productId, accountId, res)
  if (!pair) return
  if (await rejectQueueListing({ prisma, productId, accountId, status: pair.product.status, res })) {
    return
  }
  const listing = await writeQueuedListing(prisma, productId, accountId, pair.product.status)
  await nudgeAutopost(pair.account)
  res.json({ listing: toListingJson(listing) })
}

async function rejectQueueListing(input: {
  prisma: PrismaDb
  productId: string
  accountId: string
  status: string
  res: Response
}) {
  if (
    await rejectReadyToPostWithoutBrand(
      input.prisma,
      input.productId,
      { status: "READY_TO_POST", externalUrl: null },
      input.res,
    )
  ) {
    return true
  }
  const existing = await input.prisma.productListing.findUnique({
    where: { productId_accountId: { productId: input.productId, accountId: input.accountId } },
    select: { status: true, externalUrl: true },
  })
  if (!listingBlocksManualQueue(input.status, existing)) return false
  sendError(
    input.res,
    409,
    "ALREADY_POSTED",
    "Este producto ya está publicado o se está publicando en esta cuenta.",
  )
  return true
}

async function nudgeAutopost(account: { id: string; isDefault: boolean; autopostEnabled: boolean }) {
  if (!account.autopostEnabled) return
  if (account.isDefault) await rescheduleAutopostLoop()
  else await scheduleAccountAutopost(account.id)
}
