import type { Prisma } from "../../generated/prisma/client"
import type { Request, Response } from "express"
import { ZodError } from "zod"

import { productListingApiPutBodySchema } from "../../../lib/validations/listing"
import {
  DEFAULT_ACCOUNT_MISSING_MESSAGE,
  findDefaultAccountId,
} from "../lib/default-account"
import { getPrisma } from "../lib/db"
import { sendError } from "../lib/http-error"
import { listingJsonSelect, toListingJson } from "../lib/listing-json"
import { paramId } from "./products"

function sendZod(res: Response, error: ZodError) {
  sendError(
    res,
    400,
    "VALIDATION_ERROR",
    error.issues[0]?.message ?? "Invalid body.",
  )
}

async function requireDefaultAccountId(
  prisma: NonNullable<ReturnType<typeof getPrisma>>,
  res: Response,
): Promise<string | null> {
  const accountId = await findDefaultAccountId(prisma)
  if (!accountId) {
    sendError(res, 404, "NOT_FOUND", DEFAULT_ACCOUNT_MISSING_MESSAGE)
    return null
  }
  return accountId
}

async function assertProductExists(
  prisma: NonNullable<ReturnType<typeof getPrisma>>,
  productId: string,
  res: Response,
): Promise<boolean> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  })
  if (!product) {
    sendError(res, 404, "NOT_FOUND", "Product not found.")
    return false
  }
  return true
}

function buildUpsertUpdate(
  body: ReturnType<typeof productListingApiPutBodySchema.parse>,
): Prisma.ProductListingUpdateInput {
  const data: Prisma.ProductListingUpdateInput = {}
  if (body.externalUrl !== undefined) data.externalUrl = body.externalUrl
  if (body.status !== undefined) data.status = body.status
  if (body.shippingEnabled !== undefined) data.shippingEnabled = body.shippingEnabled
  if (body.shippingUpToKg !== undefined) data.shippingUpToKg = body.shippingUpToKg
  return data
}

function buildUpsertCreate(
  productId: string,
  accountId: string,
  body: ReturnType<typeof productListingApiPutBodySchema.parse>,
): Prisma.ProductListingCreateInput {
  return {
    product: { connect: { id: productId } },
    account: { connect: { id: accountId } },
    status: body.status ?? "READY_TO_POST",
    shippingEnabled: body.shippingEnabled ?? false,
    externalUrl: body.externalUrl ?? null,
    shippingUpToKg: body.shippingUpToKg ?? null,
  }
}

export async function getProductListing(req: Request, res: Response) {
  const productId = paramId(req)
  if (!productId) {
    sendError(res, 404, "NOT_FOUND", "Product not found.")
    return
  }

  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "Database is not configured.")
    return
  }

  const accountId = await requireDefaultAccountId(prisma, res)
  if (!accountId) return

  if (!(await assertProductExists(prisma, productId, res))) return

  const listing = await prisma.productListing.findUnique({
    where: {
      productId_accountId: { productId, accountId },
    },
    select: listingJsonSelect,
  })

  if (!listing) {
    sendError(res, 404, "NOT_FOUND", "Listing not found.")
    return
  }

  res.json({ listing: toListingJson(listing) })
}

export async function putProductListing(req: Request, res: Response) {
  const productId = paramId(req)
  if (!productId) {
    sendError(res, 404, "NOT_FOUND", "Product not found.")
    return
  }

  let body: ReturnType<typeof productListingApiPutBodySchema.parse>
  try {
    body = productListingApiPutBodySchema.parse(req.body)
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

  const accountId = await requireDefaultAccountId(prisma, res)
  if (!accountId) return

  if (!(await assertProductExists(prisma, productId, res))) return

  const listing = await prisma.productListing.upsert({
    where: {
      productId_accountId: { productId, accountId },
    },
    create: buildUpsertCreate(productId, accountId, body),
    update: buildUpsertUpdate(body),
    select: listingJsonSelect,
  })

  res.json({ listing: toListingJson(listing) })
}
