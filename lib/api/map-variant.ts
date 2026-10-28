import type { DuplicateVariant } from "@/lib/inventory/types"

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

/** listings[].variant from GET /products/:id; null when absent or malformed. */
export function asDuplicateVariant(value: unknown): DuplicateVariant | null {
  if (!value || typeof value !== "object") return null
  const row = value as Record<string, unknown>
  return {
    title: textOrNull(row.title),
    description: textOrNull(row.description),
    price: typeof row.price === "number" && Number.isFinite(row.price) ? row.price : null,
    source: row.source === "ai" || row.source === "manual" ? row.source : null,
    generatedAt: textOrNull(row.generatedAt),
    error: textOrNull(row.error),
    stale: row.stale === true,
  }
}
