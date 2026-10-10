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
    shippingEnabled: body.shippingEnabled ?? true,
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

type ListingPutBody = ReturnType<typeof productListingApiPutBodySchema.parse>
type PrismaDb = NonNullable<ReturnType<typeof getPrisma>>

async function parseListingPutBody(req: Request, res: Response) {
  try {
    return productListingApiPutBodySchema.parse(req.body)
  } catch (error) {
    if (error instanceof ZodError) {
      sendZod(res, error)
      return null
    }
    throw error
  }
}

async function rejectReadyToPostWithoutBrand(
  prisma: PrismaDb,
  productId: string,
  body: ListingPutBody,
  res: Response,
): Promise<boolean> {
  if (body.status !== "READY_TO_POST") return false
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { brand: true },
  })
  if (product?.brand?.trim()) return false
  sendError(
    res,
    400,
    "BRAND_REQUIRED",
    "Introduce una marca. Wallapop no deja publicar el anuncio sin Marca.",
  )
  return true
}

async function rejectPostingStatusChange(input: {
  prisma: PrismaDb
  productId: string
  accountId: string
  body: ListingPutBody
  res: Response
}): Promise<boolean> {
  const { prisma, productId, accountId, body, res } = input
  if (body.status === undefined) return false
  const existing = await prisma.productListing.findUnique({
    where: { productId_accountId: { productId, accountId } },
    select: { status: true },
  })
  if (existing?.status !== "POSTING") return false
  if (
    body.status === "ACTIVE" ||
    body.status === "RESERVED" ||
    body.status === "DEACTIVATED"
  ) {
    return false
  }
  sendError(
    res,
    409,
    "PUBLISH_IN_PROGRESS",
    "Listing is being published. Mark as ACTIVE to recover, or omit status to update the URL only.",
  )
  return true
}

export async function putProductListing(req: Request, res: Response) {
  const productId = paramId(req)
  if (!productId) {
    sendError(res, 404, "NOT_FOUND", "Product not found.")
    return
  }
  const body = await parseListingPutBody(req, res)
  if (!body) return

  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "Database is not configured.")
    return
  }
  const accountId = await requireDefaultAccountId(prisma, res)
  if (!accountId) return
  if (!(await assertProductExists(prisma, productId, res))) return
  if (await rejectReadyToPostWithoutBrand(prisma, productId, body, res)) return
  if (
    await rejectPostingStatusChange({ prisma, productId, accountId, body, res })
  ) {
    return
  }

  const listing = await prisma.productListing.upsert({
    where: { productId_accountId: { productId, accountId } },
    create: buildUpsertCreate(productId, accountId, body),
    update: buildUpsertUpdate(body),
    select: listingJsonSelect,
  })
  res.json({ listing: toListingJson(listing) })
}
