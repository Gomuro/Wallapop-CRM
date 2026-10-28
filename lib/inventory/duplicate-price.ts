/**
 * Price of a duplicate ad (same product on a second account): always ends in ,98.
 * The nearest X,98 at or below the original, except that ,95 to ,97 round up
 * to ,98 (the client's own examples: 9,95 -> 9,98, 49,95 -> 49,98).
 * 10,00 -> 9,98 and 10,50 -> 9,98, so a duplicate never costs more than 3 cents extra.
 */
const ROUND_UP_CENTS = 3
const ENDING_CENTS = 98

export function duplicatePriceCents(originalCents: number): number {
  const cents = Math.round(originalCents)
  const sameEuro = Math.floor(cents / 100) * 100 + ENDING_CENTS
  const picked = sameEuro <= cents + ROUND_UP_CENTS ? sameEuro : sameEuro - 100
  return Math.max(picked, ENDING_CENTS)
}

export function duplicatePrice(original: number): number {
  return duplicatePriceCents(original * 100) / 100
}
