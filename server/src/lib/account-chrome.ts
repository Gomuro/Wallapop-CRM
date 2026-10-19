import path from "node:path"

import {
  chromePlaceAt,
  FIRST_ACCOUNT_CDP_PORT,
  type ChromePlace,
} from "../../../lib/accounts/chrome-place"
import { getPrisma } from "./db"

type AccountRow = {
  id: string
  chromeSlot: number
}

/** Next free slot. Freed slots stay free so a new account does not reuse a profile. */
export function nextChromeSlot(slots: number[]): number {
  if (slots.length === 0) return 0
  return Math.max(...slots) + 1
}

export function assignChromePlaces(rows: AccountRow[]): Map<string, ChromePlace> {
  const places = new Map<string, ChromePlace>()
  for (const row of rows) {
    places.set(row.id, chromePlaceAt(row.chromeSlot))
  }
  return places
}

export async function chromePortForAccount(accountId: string): Promise<number> {
  const prisma = getPrisma()
  if (!prisma) return FIRST_ACCOUNT_CDP_PORT
  const accounts = await prisma.account.findMany({
    select: { id: true, chromeSlot: true },
  })
  return assignChromePlaces(accounts).get(accountId)?.port ?? FIRST_ACCOUNT_CDP_PORT
}

export function profileDirForPlace(place: ChromePlace): string {
  if (
    place.profileName === "ChromeCDP-Persistent" &&
    process.env.WALLAPOP_CHROME_USER_DATA_DIR?.trim()
  ) {
    return process.env.WALLAPOP_CHROME_USER_DATA_DIR.trim()
  }
  return path.resolve(process.env.USERPROFILE ?? "", place.profileName)
}
