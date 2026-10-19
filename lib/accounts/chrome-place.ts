/**
 * One Wallapop account, one Chrome. Ports are pinned: 9222, then 9232, 9242.
 * Slot 0 keeps the profile folder ChromeCDP-Persistent.
 * The slot is stored on the account. Deleting a card does not slide the others down.
 */
export const FIRST_ACCOUNT_CDP_PORT = 9222
export const FIRST_ACCOUNT_PROFILE_NAME = "ChromeCDP-Persistent"
export const ACCOUNT_CDP_PORT_STEP = 10

export type ChromePlace = {
  port: number
  profileName: string
}

/** Slot 0 is port 9222. Later slots step the port by 10. */
export function chromePlaceAt(index: number): ChromePlace {
  const place = Number.isInteger(index) && index > 0 ? index : 0
  if (place === 0) {
    return {
      port: FIRST_ACCOUNT_CDP_PORT,
      profileName: FIRST_ACCOUNT_PROFILE_NAME,
    }
  }
  const port = FIRST_ACCOUNT_CDP_PORT + place * ACCOUNT_CDP_PORT_STEP
  return { port, profileName: `ChromeCDP-${port}` }
}

export function firstCdpPort(): number {
  const raw = Number(process.env.WALLAPOP_CDP_PORT)
  if (Number.isFinite(raw) && raw > 0) return raw
  return FIRST_ACCOUNT_CDP_PORT
}
