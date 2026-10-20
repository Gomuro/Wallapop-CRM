import type { WallapopConnectionStatus } from "../../../../lib/validations/account"

import { assignChromePlaces } from "../account-chrome"
import { getPrisma } from "../db"

export type WallapopSessionSnapshot = {
  status: WallapopConnectionStatus
  requires2FA: boolean
  email: string | null
  error?: string
  listingsReset?: boolean
}

export type SessionState = {
  status: WallapopConnectionStatus
  requires2FA: boolean
  email: string | null
  error: string | null
}

export type AccountTarget = {
  accountId: string
  port: number
}

const sessions = new Map<string, SessionState>()
const generations = new Map<string, number>()
let defaultAccountId: string | null = null

export function emptySession(): SessionState {
  return {
    status: "DISCONNECTED",
    requires2FA: false,
    email: null,
    error: null,
  }
}

export function nextGeneration(accountId: string): number {
  const gen = (generations.get(accountId) ?? 0) + 1
  generations.set(accountId, gen)
  return gen
}

export function readGeneration(accountId: string): number | undefined {
  return generations.get(accountId)
}

export function generationOf(accountId: string): number {
  return readGeneration(accountId) ?? 0
}

export function setGeneration(accountId: string, gen: number): void {
  generations.set(accountId, gen)
}

/** Forget an in-memory login after the account row is removed. */
export function dropWallapopSession(accountId: string): void {
  nextGeneration(accountId)
  sessions.delete(accountId)
  if (defaultAccountId === accountId) defaultAccountId = null
}

export function sessionRow(accountId: string): SessionState {
  let row = sessions.get(accountId)
  if (!row) {
    row = emptySession()
    sessions.set(accountId, row)
  }
  return row
}

export function snapshotOf(row: SessionState): WallapopSessionSnapshot {
  return {
    status: row.status,
    requires2FA: row.requires2FA,
    email: row.email,
    ...(row.error ? { error: row.error } : {}),
  }
}

export async function resolveAccountTarget(accountId?: string): Promise<AccountTarget> {
  const prisma = getPrisma()
  if (!prisma) throw new Error("Database is not configured.")
  const accounts = await prisma.account.findMany({
    select: { id: true, isDefault: true, createdAt: true, chromeSlot: true },
  })
  const fallback = accounts.find((row) => row.isDefault) ?? accounts[0]
  if (!fallback) throw new Error("Default account is not configured.")
  defaultAccountId = fallback.isDefault ? fallback.id : defaultAccountId ?? fallback.id
  const chosen = accountId ? accounts.find((row) => row.id === accountId) : fallback
  if (!chosen) throw new Error("Cuenta no encontrada.")
  if (chosen.isDefault) defaultAccountId = chosen.id
  const place = assignChromePlaces(accounts).get(chosen.id)
  return { accountId: chosen.id, port: place?.port ?? 9222 }
}

function snapshot(): WallapopSessionSnapshot {
  if (!defaultAccountId) return snapshotOf(emptySession())
  return snapshotOf(sessionRow(defaultAccountId))
}

/** @deprecated Prefer getWallapopSessionSnapshot — sync view without CDP rehydrate. */
export function getWallapopSession(): WallapopSessionSnapshot {
  return snapshot()
}

export function peekWallapopSession(accountId: string): WallapopSessionSnapshot {
  const row = sessions.get(accountId)
  if (!row) return snapshotOf(emptySession())
  return snapshotOf(row)
}
