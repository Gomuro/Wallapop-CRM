export type EliminarStep =
  | "attach"
  | "item"
  | "before_confirm"
  | "confirm"
  | "verify"
  | "eliminated"

export class WallapopEliminarError extends Error {
  readonly step: EliminarStep
  constructor(step: EliminarStep, message: string) {
    super(message)
    this.name = "WallapopEliminarError"
    this.step = step
  }
}

export type EliminarWallapopInput = {
  itemUrl: string
  dryRun: boolean
  cdpPort?: number
}

export type EliminarWallapopResult = {
  dryRun: boolean
  step: EliminarStep
  itemUrl: string
}
