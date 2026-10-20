import "../load-env"

import { selectedIdsForField } from "../../lib/inventory/category-upload-fields"
import {
  isBrandRequiredForCategory,
  wallapopBrandFromProduct,
} from "../../lib/inventory/wallapop-brand"
import { groqChatJson } from "../src/lib/groq-chat-json"

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function extraBrandMissing(typeAttributes: unknown) {
  return selectedIdsForField(typeAttributes, "brand").length < 1
}

function cleanBrand(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const brand = raw.trim()
  if (!brand || brand.length > 80) return null
  if (/^(null|n\/a|none|sin marca|unknown|marca)$/i.test(brand)) return null
  return brand
}

function groqPrompt(product: {
  title: string
  description: string
  brand: string | null
}) {
  return [
    "Extrae la marca comercial de un anuncio de Wallapop.",
    'Devuelve JSON: {"brand":"Nombre"} o {"brand":null}.',
    "Usa el título y la descripción. No inventes una marca si no está clara.",
    "No uses palabras genéricas (colchón, mesa, silla) como marca.",
    `Título: ${product.title}`,
    `Marca CRM: ${product.brand ?? ""}`,
    `Descripción:\n${product.description.slice(0, 4000)}`,
  ].join("\n")
}

async function groqBrand(product: {
  title: string
  description: string
  brand: string | null
}): Promise<string | null> {
  const picked = await groqChatJson(
    'Respondes solo JSON válido con clave "brand".',
    groqPrompt(product),
  )
  return cleanBrand(picked.brand)
}

function isDryRun(argv: string[]) {
  return argv.includes("--dry-run")
}

function wantsVpsDatabase(argv: string[]) {
  return argv.includes("--vps")
}

function limitOf(argv: string[]): number | null {
  const i = argv.indexOf("--limit")
  if (i < 0) return null
  const n = Number(argv[i + 1])
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null
}

async function main() {
  const argv = process.argv.slice(2)
  const dryRun = isDryRun(argv)
  const connectionString = wantsVpsDatabase(argv)
    ? process.env.DATABASE_URL_VPS
    : process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error(
      wantsVpsDatabase(argv)
        ? "DATABASE_URL_VPS is not set"
        : "DATABASE_URL is not set",
    )
  }

  const { PrismaPg } = await import("@prisma/adapter-pg")
  const { PrismaClient } = await import("../generated/prisma/client")
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  })

  try {
    const products = await prisma.product.findMany({
      where: { status: { not: "SOLD" } },
      select: {
        id: true,
        sku: true,
        title: true,
        description: true,
        brand: true,
        typeAttributes: true,
        category: { select: { attributes: true } },
      },
      orderBy: { createdAt: "asc" },
    })

    let planned = 0
    let updated = 0
    let skipped = 0
    let groqCalls = 0
    const limit = limitOf(argv)

    for (const product of products) {
      if (limit != null && planned >= limit) break
      if (!isBrandRequiredForCategory(product.category.attributes)) {
        skipped += 1
        continue
      }
      if (!extraBrandMissing(product.typeAttributes)) {
        skipped += 1
        continue
      }

      let brand = cleanBrand(
        wallapopBrandFromProduct({
          brand: product.brand,
          description: product.description,
          typeAttributes: product.typeAttributes,
        }),
      )
      let source = brand ? "existing" : "none"
      if (!brand) {
        groqCalls += 1
        brand = await groqBrand(product)
        source = brand ? "groq" : "none"
        await new Promise((resolve) => setTimeout(resolve, 150))
      }
      if (!brand) {
        console.log(
          JSON.stringify({
            sku: product.sku,
            title: product.title,
            skipped: "no_brand",
          }),
        )
        skipped += 1
        continue
      }

      planned += 1
      const next = { ...(asRecord(product.typeAttributes) ?? {}) }
      next.brand = [brand]
      console.log(
        JSON.stringify({
          sku: product.sku,
          title: product.title,
          brand,
          source,
          dryRun,
        }),
      )
      if (dryRun) continue
      await prisma.product.update({
        where: { id: product.id },
        data: {
          brand,
          typeAttributes: next as object,
        },
      })
      updated += 1
    }

    console.log(
      JSON.stringify({ ok: true, planned, updated, skipped, groqCalls, dryRun }),
    )
  } finally {
    await prisma.$disconnect()
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
