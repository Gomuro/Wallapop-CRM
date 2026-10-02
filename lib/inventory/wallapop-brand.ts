export function brandFromTypeAttributes(
  typeAttributes: unknown,
): string | null {
  if (!typeAttributes || typeof typeAttributes !== "object") return null
  const record = typeAttributes as Record<string, unknown>
  for (const key of ["brand", "Marca", "marca"]) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return null
}

/** First `Marca …` line from imported Amazon-style specs in the description. */
export function brandFromDescription(
  description: string | null | undefined,
): string | null {
  if (!description) return null
  const match = description.match(/^Marca\s*[:.]?\s*(.+)$/im)
  const line = match?.[1]?.split(/\r?\n/)[0]?.trim()
  if (!line || line.length > 80) return null
  return line
}

export function wallapopBrandFromProduct(product: {
  brand?: string | null
  description?: string | null
  typeAttributes?: unknown
}): string | null {
  const fromField = product.brand?.trim()
  if (fromField) return fromField
  return (
    brandFromTypeAttributes(product.typeAttributes) ??
    brandFromDescription(product.description)
  )
}
