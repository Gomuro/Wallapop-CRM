/**
 * Price of a duplicate ad (same product on another account). Each account has its own
 * ending (accounts.price_ending: 98 for the second account, e.g. 97 for a third), so
 * duplicates never share a price. The nearest X,<ending> at or below the original,
 * except that it may round up by at most 3 cents (the client's examples with ending 98:
 * 9,95 -> 9,98, 49,95 -> 49,98). 10,00 -> 9,98 and 10,50 -> 9,98.
 */
const ROUND_UP_CENTS = 3
export const DEFAULT_PRICE_ENDING = 98

function validEnding(ending: number): number {
  const cents = Math.round(ending)
  return cents >= 0 && cents <= 99 ? cents : DEFAULT_PRICE_ENDING
}

export function duplicatePriceCents(originalCents: number, ending = DEFAULT_PRICE_ENDING): number {
  const cents = Math.round(originalCents)
  const end = validEnding(ending)
  const sameEuro = Math.floor(cents / 100) * 100 + end
  const picked = sameEuro <= cents + ROUND_UP_CENTS ? sameEuro : sameEuro - 100
  return Math.max(picked, end)
}

export function duplicatePrice(original: number, ending = DEFAULT_PRICE_ENDING): number {
  return duplicatePriceCents(original * 100, ending) / 100
}
