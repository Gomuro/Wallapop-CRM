export const CATALOG_SOLD_URL = "https://es.wallapop.com/app/catalog/sold"

export type SoldStep =
  | "attach"
  | "item"
  | "before_confirm"
  | "confirm"
  | "vendidos"
  | "sold"

export class WallapopSoldError extends Error {
  readonly step: SoldStep
  constructor(step: SoldStep, message: string) {
    super(message)
    this.name = "WallapopSoldError"
    this.step = step
  }
}

/**
 * The job shows "<step>: <message>". A raw Playwright error keeps the step it stopped at.
 * VPS 2026-10-23 10:29: a confirm-step navigation error was shown as "attach".
 */
export function soldErrorAt(step: SoldStep, error: unknown): WallapopSoldError {
  if (error instanceof WallapopSoldError) return error
  return new WallapopSoldError(step, error instanceof Error ? error.message : String(error))
}

export type MarkWallapopSoldInput = {
  itemUrl: string
  dryRun: boolean
  cdpPort?: number
  /** Sibling follow-up: the ad may not be the first Vendidos row. */
  matchAnywhere?: boolean
}

export type MarkWallapopSoldResult = {
  dryRun: boolean
  step: SoldStep
  itemUrl: string
}
