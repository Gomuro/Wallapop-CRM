export const listingVariantSelect = {
  variantTitle: true,
  variantDescription: true,
  variantPrice: true,
  variantSource: true,
  variantBasis: true,
  variantGeneratedAt: true,
  variantError: true,
} as const

export type ListingVariantRow = {
  variantTitle: string | null
  variantDescription: string | null
  variantPrice: { toString(): string } | null
  variantSource: string | null
  variantBasis: string | null
  variantGeneratedAt: Date | null
  variantError: string | null
}

/** null when the listing has neither a variant nor a failed attempt. */
export function toVariantJson(row: ListingVariantRow, currentBasis: string) {
  if (!row.variantTitle && !row.variantError) return null
  return {
    title: row.variantTitle,
    description: row.variantDescription,
    price: row.variantPrice == null ? null : Number(row.variantPrice.toString()),
    source: row.variantSource,
    generatedAt: row.variantGeneratedAt?.toISOString() ?? null,
    error: row.variantError,
    /** The product text changed after this variant was written. */
    stale: Boolean(row.variantTitle) && row.variantBasis !== currentBasis,
  }
}
