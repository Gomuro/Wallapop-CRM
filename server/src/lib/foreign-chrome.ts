import type { Response } from "express"

import { findDefaultAccountId } from "./default-account"
import { getPrisma } from "./db"
import { sendError } from "./http-error"

export const FOREIGN_CHROME_CODE = "FOREIGN_CHROME"

export const FOREIGN_CHROME_MESSAGE =
  "Esta cuenta todavía no abre su Chrome. La acción se detiene antes del navegador."

/** A button for a second account must not reach Chrome. No accountId means the first account. */
export function isForeignAccountChrome(input: {
  accountId: string | undefined
  defaultAccountId: string | null
}): boolean {
  if (!input.accountId) return false
  return input.accountId !== input.defaultAccountId
}

export function readActionAccountId(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined
  const value = (body as { accountId?: unknown }).accountId
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Returns true when the response is already sent and the handler must stop. */
export async function stopForeignChrome(
  res: Response,
  body: unknown,
): Promise<boolean> {
  const accountId = readActionAccountId(body)
  if (!accountId) return false
  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "Database is not configured.")
    return true
  }
  const defaultAccountId = await findDefaultAccountId(prisma)
  if (!isForeignAccountChrome({ accountId, defaultAccountId })) return false
  sendError(res, 409, FOREIGN_CHROME_CODE, FOREIGN_CHROME_MESSAGE)
  return true
}
