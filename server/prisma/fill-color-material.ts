import "../load-env"

import {
  extraUploadFields,
  selectedIdsForField,
  uploadFieldsFromCategoryAttributes,
  type CategoryUploadField,
} from "../../lib/inventory/category-upload-fields"

const FIELD_IDS = ["color", "material"] as const
const GROQ_MODEL = "qwen/qwen3.8-27b"

type FieldId = (typeof FIELD_IDS)[number]

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function resolveOptionId(
  raw: string,
  options: { id: string; title: string }[],
): string | null {
  const n = raw.trim().toLowerCase()
  if (!n) return null
  const byId = options.find((row) => row.id.toLowerCase() === n)
  if (byId) return byId.id
  const byTitle = options.find((row) => row.title.toLowerCase() === n)
  return byTitle?.id ?? null
}

export function clampPickedIds(
  raw: unknown,
  field: CategoryUploadField,
): string[] {
  const list = Array.isArray(raw) ? raw.map((item) => String(item)) : []
  const seen = new Set<string>()
  const ids: string[] = []
  for (const item of list) {
    const id = resolveOptionId(item, field.options)
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
    if (ids.length >= field.max) break
  }
  if (ids.length < Math.max(1, field.min)) {
    const other = field.options.find((row) => row.id === "other")
    if (other && !seen.has(other.id)) ids.push(other.id)
  }
  return ids.slice(0, Math.max(1, field.max))
}

function missingFields(
  fields: CategoryUploadField[],
  typeAttributes: unknown,
): CategoryUploadField[] {
  const extra = extraUploadFields(fields)
  return extra.filter((field) => {
    if (!FIELD_IDS.includes(field.id as FieldId)) return false
    if (!field.required) return false
    if (field.options.length < 1) return false
    return selectedIdsForField(typeAttributes, field.id).length <
      Math.max(1, field.min)
  })
}

function buildPrompt(
  product: { title: string; description: string; brand: string | null },
  fields: CategoryUploadField[],
): string {
  const blocks = fields.map((field) => {
    const options = field.options
      .map((row) => `${row.id} (${row.title})`)
      .join(", ")
    return `${field.id}: elige ${field.min}–${field.max} ids de: ${options}`
  })
  return [
    "Clasifica un anuncio de Wallapop.",
    "Devuelve JSON con claves exactamente iguales a los campos.",
    "Cada valor es un array de ids de la lista. No inventes ids.",
    "Elige el color o material más probable según título y descripción.",
    "Usa other solo si ningún id de la lista encaja de verdad.",
    `Título: ${product.title}`,
    `Marca: ${product.brand ?? ""}`,
    `Descripción:\n${product.description.slice(0, 4000)}`,
    ...blocks,
  ].join("\n")
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/u, "")
    .trim()
  const parsed: unknown = JSON.parse(trimmed)
  return asRecord(parsed) ?? {}
}

async function groqPick(prompt: string): Promise<Record<string, unknown>> {
  const key = process.env.GROQ_API_KEY?.trim()
  if (!key) throw new Error("GROQ_API_KEY is not set")
  let last = "Groq failed"
  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt))
    }
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Respondes solo JSON válido. Las claves son color y/o material; los valores son arrays de ids.",
          },
          { role: "user", content: prompt },
        ],
      }),
    })
    const body = (await res.json()) as {
      error?: { message?: string }
      choices?: { message?: { content?: string } }[]
    }
    if (!res.ok) {
      last = body.error?.message || `Groq HTTP ${res.status}`
      if (res.status === 429 || /try again|unavailable|rate/i.test(last)) {
        continue
      }
      throw new Error(last)
    }
    const text = body.choices?.[0]?.message?.content?.trim()
    if (!text) {
      last = "Groq returned empty text"
      continue
    }
    try {
      return parseJsonObject(text)
    } catch {
      last = "Groq returned invalid JSON"
    }
  }
  throw new Error(last)
}

function isDryRun(argv: string[]) {
  return argv.includes("--dry-run")
}

function useVps(argv: string[]) {
  return argv.includes("--vps")
}

function limitOf(argv: string[]): number | null {
  const i = argv.indexOf("--limit")
  if (i < 0) return null
  const n = Number(argv[i + 1])
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null
}

function productIdOf(argv: string[]): string | null {
  const i = argv.indexOf("--product-id")
  if (i < 0) return null
  const id = argv[i + 1]?.trim()
  return id || null
}

async function main() {
  const argv = process.argv.slice(2)
  const dryRun = isDryRun(argv)
  const connectionString = useVps(argv)
    ? process.env.DATABASE_URL_VPS
    : process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error(useVps(argv) ? "DATABASE_URL_VPS is not set" : "DATABASE_URL is not set")
  }

  const { PrismaPg } = await import("@prisma/adapter-pg")
  const { PrismaClient } = await import("../generated/prisma/client")
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  })

  try {
    const onlyId = productIdOf(argv)
    const products = await prisma.product.findMany({
      where: {
        status: { not: "SOLD" },
        ...(onlyId ? { id: onlyId } : {}),
      },
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
    const limit = limitOf(argv)

    for (const product of products) {
      if (limit != null && planned >= limit) break
      const fields = extraUploadFields(
        uploadFieldsFromCategoryAttributes(product.category.attributes),
      )
      const need = missingFields(fields, product.typeAttributes)
      if (need.length < 1) {
        skipped += 1
        continue
      }
      planned += 1
      const picked = await groqPick(buildPrompt(product, need))
      const next = { ...(asRecord(product.typeAttributes) ?? {}) }
      const applied: Record<string, string[]> = {}
      for (const field of need) {
        const ids = clampPickedIds(picked[field.id], field)
        if (ids.length < 1) continue
        next[field.id] = ids
        applied[field.id] = ids
      }
      console.log(
        JSON.stringify({
          sku: product.sku,
          id: product.id,
          title: product.title,
          applied,
          dryRun,
        }),
      )
      if (!dryRun && Object.keys(applied).length > 0) {
        await prisma.product.update({
          where: { id: product.id },
          data: { typeAttributes: next as object },
        })
        updated += 1
      }
      await new Promise((resolve) => setTimeout(resolve, 150))
    }

    console.log(
      JSON.stringify({ ok: true, planned, updated, skipped, dryRun }),
    )
  } finally {
    await prisma.$disconnect()
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
