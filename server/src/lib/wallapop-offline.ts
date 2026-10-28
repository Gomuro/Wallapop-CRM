/** Local copy of prod: no Chrome and no Wallapop. Unset on the VPS. */
export function isWallapopOffline(): boolean {
  return process.env.WALLAPOP_OFFLINE === "1"
}

export class WallapopOfflineError extends Error {
  constructor() {
    super("WALLAPOP_OFFLINE=1: Chrome y Wallapop desactivados en este servidor.")
    this.name = "WallapopOfflineError"
  }
}

/** Hard stop at every Chrome entry point while offline. */
export function assertWallapopOnline(): void {
  if (isWallapopOffline()) throw new WallapopOfflineError()
}
