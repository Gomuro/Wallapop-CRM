import type { Request, Response } from "express"

import { duplicatePrice } from "../../../lib/inventory/duplicate-price"
import { getPrisma } from "../lib/db"
import { sendError } from "../lib/http-error"
import { listingVariantSelect, toVariantJson } from "../lib/listing-variant/json"
import { variantBasis } from "../lib/listing-variant/store"
import { writeListingVariant } from "../lib/listing-variant/worker"
import { scheduleAccountAutopost } from "../lib/wallapop-autopost"
import { VARIANT_TITLE_MAX } from "../lib/listing-variant/validate"
import { paramId } from "./products"

type PrismaDb = NonNullable<ReturnType<typeof getPrisma>>

/** The text of a live or in-flight duplicate must match what Wallapop shows. */
const LOCKED_STATUSES = new Set(["POSTING", "ACTIVE", "RESERVED"])

type VariantTarget = {
  prisma: PrismaDb
  productId: string
  accountId: string
  status: string
  variantAttempts: number
  source: { title: string; description: string; brand: string | null; price: number }
}

async function loadTarget(req: Request, res: Response): Promise<VariantTarget | null> {
  const productId = paramId(req)
  const accountId = typeof req.body?.accountId === "string" ? req.body.accountId.trim() : ""
  const prisma = getPrisma()
  if (!productId || !accountId || !prisma) {
    sendError(res, 400, "VALIDATION_ERROR", "Falta el producto o la cuenta.")
    return null
  }
  const listing = await prisma.productListing.findUnique({
    where: { productId_accountId: { productId, accountId } },
    select: {
      status: true,
      variantAttempts: true,
      account: { select: { isDefault: true } },
      product: { select: { title: true, description: true, brand: true, price: true } },
    },
  })
  if (!listing || listing.account.isDefault) {
    sendError(res, 404, "NOT_FOUND", "No hay duplicado de este producto en esa cuenta.")
    return null
  }
  if (LOCKED_STATUSES.has(listing.status)) {
    sendError(res, 409, "VARIANT_LOCKED", "El duplicado ya está en Wallapop o publicándose.")
    return null
  }
  const { price, ...text } = listing.product
  return {
    prisma,
    productId,
    accountId,
    status: listing.status,
    variantAttempts: listing.variantAttempts,
    source: { ...text, price: Number(price.toString()) },
  }
}

async function sendVariant(target: VariantTarget, res: Response) {
  const row = await target.prisma.productListing.findUnique({
    where: { productId_accountId: { productId: target.productId, accountId: target.accountId } },
    select: listingVariantSelect,
  })
  res.json({ variant: row ? toVariantJson(row, variantBasis(target.source)) : null })
}

export async function regenerateProductVariant(req: Request, res: Response) {
  const target = await loadTarget(req, res)
  if (!target) return
  const outcome = await writeListingVariant(target.prisma, target, { regenerate: true })
  if (!outcome.ok) {
    sendError(res, 422, "VARIANT_FAILED", outcome.error)
    return
  }
  if (target.status === "PREPARING") await scheduleAccountAutopost(target.accountId)
  await sendVariant(target, res)
}

function manualText(body: unknown): { title: string; description: string } | string {
  const record = (body ?? {}) as { title?: unknown; description?: unknown }
  const title = typeof record.title === "string" ? record.title.trim() : ""
  const description = typeof record.description === "string" ? record.description.trim() : ""
  if (!title || !description) return "El título y la descripción son obligatorios."
  if (title.length > VARIANT_TITLE_MAX) {
    return `El título tiene ${title.length} caracteres (máximo ${VARIANT_TITLE_MAX}).`
  }
  return { title, description }
}

export async function putProductVariant(req: Request, res: Response) {
  const text = manualText(req.body)
  if (typeof text === "string") {
    sendError(res, 400, "VALIDATION_ERROR", text)
    return
  }
  const target = await loadTarget(req, res)
  if (!target) return
  await target.prisma.productListing.update({
    where: { productId_accountId: { productId: target.productId, accountId: target.accountId } },
    data: {
      variantTitle: text.title,
      variantDescription: text.description,
      variantPrice: duplicatePrice(target.source.price),
      variantSource: "manual",
      variantBasis: variantBasis(target.source),
      variantGeneratedAt: new Date(),
      variantError: null,
      variantAttempts: 0,
      variantNextAttemptAt: null,
      ...(target.status === "PREPARING" ? { status: "READY_TO_POST" as const } : {}),
    },
  })
  if (target.status === "PREPARING") await scheduleAccountAutopost(target.accountId)
  await sendVariant(target, res)
}
