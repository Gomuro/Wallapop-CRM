import type { Request, Response } from "express"
import { ZodError } from "zod"

import type { PrismaClient } from "../../generated/prisma/client"
import { getPrisma } from "../lib/db"
import { sendError } from "../lib/http-error"
import { loadAutopostStatus } from "../lib/wallapop-autopost"
import { listWorkerJobs } from "../lib/wallapop-worker-jobs"
import type { WallapopSessionSnapshot } from "../lib/wallapop-session"

type AccountRowIdentity = {
  id: string
  name: string
  status: string
  isDefault: boolean
  createdAt: Date
  updatedAt: Date
}

type AccountRowPlace = {
  city: string | null
  postalCode: string | null
  wallapopEmail: string | null
  autopostIntervalMs: number | null
  autopostEnabled: boolean
}

export type AccountRow = AccountRowIdentity & AccountRowPlace

export function requirePrisma(res: Response): PrismaClient | null {
  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "Database is not configured.")
    return null
  }
  return prisma
}

export function rejectedZod(res: Response, error: unknown): boolean {
  if (!(error instanceof ZodError)) return false
  sendError(
    res,
    400,
    "VALIDATION_ERROR",
    error.issues[0]?.message ?? "Invalid body.",
  )
  return true
}

export function readAccountId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function routeAccountId(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export function accountIdFrom(req: Request): string | undefined {
  return routeAccountId(req.params.id)
}

export function toAccountJson(row: AccountRow) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    isDefault: row.isDefault,
    city: row.city,
    postalCode: row.postalCode,
    autopostIntervalMs: row.autopostIntervalMs,
    autopostEnabled: row.autopostEnabled,
    wallapopEmail: row.wallapopEmail,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function withChromePlace<T extends { id: string }>(
  row: T,
  places: Map<string, { port: number; profileName: string }>,
) {
  const place = places.get(row.id)
  return {
    ...row,
    cdpPort: place?.port ?? 9222,
    profileName: place?.profileName ?? "ChromeCDP-Persistent",
  }
}

export function toSessionJson(session: WallapopSessionSnapshot) {
  return {
    status: session.status,
    requires2FA: session.requires2FA,
    email: session.email,
    proxy: session.proxy ?? null,
    ...(session.error ? { error: session.error } : {}),
    ...(session.listingsReset ? { listingsReset: true } : {}),
  }
}

export async function sendAccountPayload(
  res: Response,
  prisma: PrismaClient,
  account: AccountRow,
  focusAccountId?: string,
) {
  res.json({
    account: toAccountJson(account),
    autopost: await loadAutopostStatus(prisma, focusAccountId),
    workers: listWorkerJobs(),
  })
}
