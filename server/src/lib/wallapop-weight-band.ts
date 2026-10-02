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

/**
 * Map CRM `weightKg` onto a Wallapop Estándar band.
 * Upper bound inclusive: 2 → «1 a 2 kg», 10 → «5 a 10 kg». No wrapping bump.
 * Returns null when the weight is above the last band (30 kg).
 */
export function wallapopStandardWeightBandLabel(
  weightKg: number,
): string | null {
  if (!Number.isFinite(weightKg) || weightKg < 0) return null
  for (const band of STANDARD_WEIGHT_BANDS) {
    if (weightKg <= band.maxKg) return band.needle
  }
  return null
}

/** Same as `wallapopStandardWeightBandLabel` — CRM kg is the band, not kg + box. */
export function wallapopStandardWeightBandFromCrm(
  weightKg: number,
): string | null {
  return wallapopStandardWeightBandLabel(weightKg)
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
