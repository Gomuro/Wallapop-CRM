export type ReserveStep = "attach" | "item" | "reserved"

export class WallapopReserveError extends Error {
  readonly step: ReserveStep

  constructor(step: ReserveStep, message: string) {
    super(message)
    this.name = "WallapopReserveError"
    this.step = step
  }
}

export type MarkWallapopReservedInput = {
  itemUrl: string
  cdpPort?: number
}

export type MarkWallapopReservedResult = {
  itemUrl: string
  step: "reserved"
  already: boolean
}
