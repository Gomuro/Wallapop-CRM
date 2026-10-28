import { createHash } from "node:crypto"

import type { PrismaClient } from "../../../generated/prisma/client"
import { duplicatePrice } from "../../../../lib/inventory/duplicate-price"
import { log } from "../log"
import { generateVariantText } from "./generate"
import type { VariantSource } from "./validate"

export type VariantData = {
  variantTitle: string
  variantDescription: string
  variantPrice: number
  variantSource: string
  variantBasis: string
  variantGeneratedAt: Date
  variantError: null
}

export type VariantOutcome =
  | { ok: true; data: VariantData | null }
  | { ok: false; error: string }

type ExistingVariant = {
  variantTitle: string | null
  variantDescription: string | null
  variantSource: string | null
  variantBasis: string | null
  variantGeneratedAt: Date | null
}

type VariantInputs = {
  isDefault: boolean
  source: VariantSource
  price: number
  existing: ExistingVariant | null
}

/** Changes when the warehouse text a variant was written from changes. */
export function variantBasis(source: VariantSource): string {
  return createHash("sha1")
    .update(`${source.title}\u0000${source.description}\u0000${source.brand ?? ""}`)
    .digest("hex")
}

async function loadVariantInputs(
  prisma: PrismaClient,
  productId: string,
  accountId: string,
): Promise<VariantInputs | null> {
  const [account, product, existing] = await Promise.all([
    prisma.account.findUnique({ where: { id: accountId }, select: { isDefault: true } }),
    prisma.product.findUnique({
      where: { id: productId },
      select: { title: true, description: true, brand: true, price: true },
    }),
    prisma.productListing.findUnique({
      where: { productId_accountId: { productId, accountId } },
      select: {
        variantTitle: true,
        variantDescription: true,
        variantSource: true,
        variantBasis: true,
        variantGeneratedAt: true,
      },
    }),
  ])
  if (!account || !product) return null
  return {
    isDefault: account.isDefault,
    source: { title: product.title, description: product.description, brand: product.brand },
    price: Number(product.price.toString()),
    existing,
  }
}

/** Keep a saved text when it still matches the product, or when a person wrote it. */
function reusableVariant(inputs: VariantInputs): VariantData | null {
  const saved = inputs.existing
  if (!saved?.variantTitle || !saved.variantDescription) return null
  const manual = saved.variantSource === "manual"
  if (!manual && saved.variantBasis !== variantBasis(inputs.source)) return null
  return {
    variantTitle: saved.variantTitle,
    variantDescription: saved.variantDescription,
    variantPrice: duplicatePrice(inputs.price),
    variantSource: saved.variantSource ?? "ai",
    variantBasis: saved.variantBasis ?? variantBasis(inputs.source),
    variantGeneratedAt: saved.variantGeneratedAt ?? new Date(),
    variantError: null,
  }
}

async function freshVariant(inputs: VariantInputs): Promise<VariantOutcome> {
  const result = await generateVariantText(inputs.source)
  if (!result.ok) return { ok: false, error: result.error }
  return {
    ok: true,
    data: {
      variantTitle: result.text.title,
      variantDescription: result.text.description,
      variantPrice: duplicatePrice(inputs.price),
      variantSource: "ai",
      variantBasis: variantBasis(inputs.source),
      variantGeneratedAt: new Date(),
      variantError: null,
    },
  }
}

/**
 * Variant fields for (product, account) without writing them.
 * data null = default account, which always publishes the original.
 */
export async function buildListingVariant(
  prisma: PrismaClient,
  productId: string,
  accountId: string,
  options: { regenerate?: boolean } = {},
): Promise<VariantOutcome> {
  const inputs = await loadVariantInputs(prisma, productId, accountId)
  if (!inputs) return { ok: false, error: "Producto o cuenta no encontrados." }
  if (inputs.isDefault) return { ok: true, data: null }
  const reused = options.regenerate ? null : reusableVariant(inputs)
  if (reused) return { ok: true, data: reused }
  return freshVariant(inputs)
}

/** Build and save on an existing listing. A failure is saved too, so the card can show it. */
export async function ensureListingVariant(
  prisma: PrismaClient,
  productId: string,
  accountId: string,
  options: { regenerate?: boolean } = {},
): Promise<VariantOutcome> {
  const outcome = await buildListingVariant(prisma, productId, accountId, options)
  const where = { productId, accountId }
  if (outcome.ok && outcome.data) {
    await prisma.productListing.updateMany({ where, data: outcome.data })
  } else if (!outcome.ok) {
    await prisma.productListing.updateMany({ where, data: { variantError: outcome.error } })
    log("warn", "listing_variant_failed", { productId, accountId, error: outcome.error })
  }
  return outcome
}
