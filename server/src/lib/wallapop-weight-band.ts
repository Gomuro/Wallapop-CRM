/** Packaging allowance for Wallapop «ten en cuenta el peso añadido del envoltorio». */
export const PACKAGING_BUFFER_KG = 0.25

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
  // 30 kg in CRM + 0.25 wrapping is still the last Estándar band, not "too heavy".
  return STANDARD_WEIGHT_BANDS[STANDARD_WEIGHT_BANDS.length - 1].needle
}

/**
 * Accessible name of the Estándar kg radio (`aria-label="Delivery Option N"`).
 * Index matches `STANDARD_WEIGHT_BANDS` order (0 a 1 kg → Delivery Option 0).
 */
export function wallapopStandardWeightBandAriaName(
  needle: string,
): string | null {
  const index = STANDARD_WEIGHT_BANDS.findIndex((b) => b.needle === needle)
  if (index < 0) return null
  return `Delivery Option ${index}`
}
