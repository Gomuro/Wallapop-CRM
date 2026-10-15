import path from "node:path"

import {
  chromePlaceAt,
  FIRST_ACCOUNT_CDP_PORT,
  type ChromePlace,
} from "../../../lib/accounts/chrome-place"
import { getPrisma } from "./db"

type AccountRow = {
  id: string
  isDefault: boolean
  createdAt: Date
}

export function assignChromePlaces(rows: AccountRow[]): Map<string, ChromePlace> {
  const places = new Map<string, ChromePlace>()
  for (const row of rows) {
    if (row.isDefault) places.set(row.id, chromePlaceAt(0))
  }
  const others = rows
    .filter((row) => !row.isDefault)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  others.forEach((row, index) => {
    places.set(row.id, chromePlaceAt(index + 1))
  })
  return places
}

export async function chromePortForAccount(accountId: string): Promise<number> {
  const prisma = getPrisma()
  if (!prisma) return FIRST_ACCOUNT_CDP_PORT
  const accounts = await prisma.account.findMany({
    select: { id: true, isDefault: true, createdAt: true },
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
