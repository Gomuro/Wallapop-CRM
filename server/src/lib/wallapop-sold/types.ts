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

export type MarkWallapopSoldInput = {
  itemUrl: string
  dryRun: boolean
}

export type MarkWallapopSoldResult = {
  dryRun: boolean
  step: SoldStep
  itemUrl: string
}
