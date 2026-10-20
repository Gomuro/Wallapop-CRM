import { chromeSlotForPort } from "../../../lib/accounts/chrome-place"
import { parseChromeProxy } from "../../../lib/accounts/chrome-proxy"
import { getPrisma } from "./db"

export async function readChromeProxyForAccount(
  accountId: string,
): Promise<string | null> {
  const prisma = getPrisma()
  if (!prisma) return null
  const row = await prisma.account.findUnique({
    where: { id: accountId },
    select: { chromeProxy: true },
  })
  return row?.chromeProxy?.trim() ? row.chromeProxy.trim() : null
}

export async function writeChromeProxyForAccount(
  accountId: string,
  input: string | null | undefined,
): Promise<string | null> {
  const parsed = parseChromeProxy(input ?? null)
  const value = parsed ? (input ?? "").trim() || null : null
  const prisma = getPrisma()
  if (!prisma) return value
  await prisma.account.update({
    where: { id: accountId },
    data: { chromeProxy: value },
  })
  return value
}

export async function readChromeProxyForPort(port: number): Promise<string | null> {
  const prisma = getPrisma()
  if (!prisma) return null
  const slot = chromeSlotForPort(port)
  if (slot == null) return null
  const row = await prisma.account.findUnique({
    where: { chromeSlot: slot },
    select: { chromeProxy: true },
  })
  return row?.chromeProxy?.trim() ? row.chromeProxy.trim() : null
}

export async function writeChromeProxyForPort(
  port: number,
  input: string | null | undefined,
): Promise<string | null> {
  const prisma = getPrisma()
  if (!prisma) return parseChromeProxy(input ?? null) ? (input ?? "").trim() : null
  const slot = chromeSlotForPort(port)
  if (slot == null) return null
  const parsed = parseChromeProxy(input ?? null)
  const value = parsed ? (input ?? "").trim() || null : null
  await prisma.account.updateMany({
    where: { chromeSlot: slot },
    data: { chromeProxy: value },
  })
  return value
}
