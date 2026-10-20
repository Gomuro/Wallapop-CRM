/** Packaging allowance for Wallapop «ten en cuenta el peso añadido del envoltorio». */
export const PACKAGING_BUFFER_KG = 0.25

/** Wallapop wraps the kg numbers in bidi marks: «‪10‬ a ‪20‬ kg». */
const WEIGHT_BAND_BIDI_RE = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g

export function normalizeWeightBandLabel(text: string): string {
  return text.replace(WEIGHT_BAND_BIDI_RE, "").replace(/\s+/g, " ").trim()
}

export const STANDARD_WEIGHT_MAX_KG = 30

/** Estándar «¿Cuánto pesa?» bands, upper bound inclusive, ascending. */
export const STANDARD_WEIGHT_BANDS = [
  { needle: "0 a 1 kg", maxKg: 1 },
  { needle: "1 a 2 kg", maxKg: 2 },
  { needle: "2 a 5 kg", maxKg: 5 },
  { needle: "5 a 10 kg", maxKg: 10 },
  { needle: "10 a 20 kg", maxKg: 20 },
  { needle: "20 a 30 kg", maxKg: 30 },
] as const

export type StandardWeightBandNeedle =
  (typeof STANDARD_WEIGHT_BANDS)[number]["needle"]

export function wallapopEffectiveWeightKg(weightKg: number): number {
  return weightKg + PACKAGING_BUFFER_KG
}

/**
 * Map already-buffered kg onto a Wallapop Estándar band label.
 * Returns null when the weight is above the last band (30 kg).
 */
export function wallapopStandardWeightBandLabel(
  effectiveKg: number,
): string | null {
  if (!Number.isFinite(effectiveKg) || effectiveKg < 0) return null
  for (const band of STANDARD_WEIGHT_BANDS) {
    if (effectiveKg <= band.maxKg) return band.needle
  }
  return null
}

/** CRM `weightKg` plus packaging buffer → Estándar band needle, or null if too heavy. */
export function wallapopStandardWeightBandFromCrm(
  weightKg: number,
): string | null {
  if (!Number.isFinite(weightKg) || weightKg < 0) return null
  if (weightKg > STANDARD_WEIGHT_MAX_KG) return null
  const labeled = wallapopStandardWeightBandLabel(
    wallapopEffectiveWeightKg(weightKg),
  )
  if (labeled) return labeled
  return STANDARD_WEIGHT_BANDS[STANDARD_WEIGHT_BANDS.length - 1].needle
}

/** Heavy Estándar bands. After one of these, the form must show Estándar / Voluminoso. */
export const HEAVY_WEIGHT_BANDS = new Set<string>(["10 a 20 kg", "20 a 30 kg"])

export function isKnownWeightBand(needle: string): needle is StandardWeightBandNeedle {
  return STANDARD_WEIGHT_BANDS.some((band) => band.needle === needle)
}

/**
 * Bands this category's upload form is allowed to show, in Estándar order.
 * Unknown labels are dropped. Empty input means the category has no list.
 */
export function normalizeCategoryWeightBands(
  needles: readonly string[] | null | undefined,
): StandardWeightBandNeedle[] {
  if (!needles?.length) return []
  const wanted = new Set(needles)
  return STANDARD_WEIGHT_BANDS.filter((band) => wanted.has(band.needle)).map(
    (band) => band.needle,
  )
}

export function weightBandsFromCategoryAttributes(
  attributes: unknown,
): StandardWeightBandNeedle[] {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) {
    return []
  }
  const raw = (attributes as { weightBands?: unknown }).weightBands
  if (!Array.isArray(raw)) return []
  return normalizeCategoryWeightBands(
    raw.filter((item): item is string => typeof item === "string"),
  )
}

/**
 * Pick a band this category actually lists. Heavier than the last allowed
 * band uses that last band. Does not change the stored kilograms.
 * Returns null when the category list is empty or the weight is not a number.
 */
export function pickCategoryWeightBand(
  weightKg: number,
  allowedNeedles: readonly string[],
): { needle: StandardWeightBandNeedle; clamped: boolean; wanted: string | null } | null {
  if (!Number.isFinite(weightKg) || weightKg < 0) return null
  const allowed = normalizeCategoryWeightBands(allowedNeedles)
  if (allowed.length === 0) return null
  const wanted = wallapopStandardWeightBandFromCrm(weightKg)
  const effective = wallapopEffectiveWeightKg(weightKg)
  for (const needle of allowed) {
    const band = STANDARD_WEIGHT_BANDS.find((item) => item.needle === needle)
    if (band && effective <= band.maxKg) {
      return { needle, clamped: wanted != null && wanted !== needle, wanted }
    }
  }
  const needle = allowed[allowed.length - 1]
  return { needle, clamped: wanted !== needle, wanted }
}

/** Text stored on the listing and shown next to «Error» on the card. */
export function publishWeightStopMessage(input: {
  wanted: string | null
  selected: string | null
  reason: "no_bands" | "no_package_size"
}): string {
  const missing =
    input.wanted && input.wanted !== input.selected
      ? `Peso ${input.wanted}: ese tramo no está en la categoría.`
      : !input.wanted && input.selected
        ? `El peso supera el último tramo de la categoría (${input.selected}).`
        : null
  if (input.reason === "no_package_size" && input.selected) {
    const size = `Tras elegir ${input.selected} no aparecieron Estándar ni Voluminoso.`
    return missing ? `${missing} ${size}` : size
  }
  if (missing) return missing
  return "No hay tramos de peso visibles en esta categoría."
}

/** CRM kg that maps into this Estándar band after the packaging buffer. */
export function crmKgForStandardBand(maxKg: number): number {
  return Math.round((maxKg - PACKAGING_BUFFER_KG) * 1000) / 1000
}
