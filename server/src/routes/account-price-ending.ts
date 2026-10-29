import type { Request, Response } from "express"

import type { PrismaClient } from "../../generated/prisma/client"
import { accountPriceEndingSchema } from "../../../lib/validations/account"
import { sendError } from "../lib/http-error"
import { repriceQueuedDuplicates } from "../lib/listing-variant/reprice"
import { log } from "../lib/log"
import { accountIdFrom, rejectedZod, requirePrisma, toAccountJson } from "./account-http"

function parseBody(req: Request, res: Response): number | null {
  try {
    return accountPriceEndingSchema.parse(req.body).priceEnding
  } catch (error) {
    if (rejectedZod(res, error)) return null
    throw error
  }
}

function cents(ending: number): string {
  return String(ending).padStart(2, "0")
}

/** The account to change, or null after an error response. */
async function editableAccount(prisma: PrismaClient, res: Response, accountId: string | undefined, priceEnding: number) {
  const account = accountId ? await prisma.account.findUnique({ where: { id: accountId } }) : null
  if (!account) {
    sendError(res, 404, "NOT_FOUND", "Cuenta no encontrada.")
    return null
  }
  if (account.isDefault) {
    sendError(res, 409, "DEFAULT_ACCOUNT", "La cuenta principal publica el precio original, sin terminación.")
    return null
  }
  const taken = await prisma.account.findFirst({
    where: { id: { not: account.id }, isDefault: false, priceEnding },
    select: { name: true },
  })
  if (taken) {
    sendError(res, 409, "PRICE_ENDING_TAKEN", `La cuenta ${taken.name} ya usa la terminación ,${cents(priceEnding)}.`)
    return null
  }
  return account
}

/**
 * PATCH /accounts/:id/price-ending. Only for a non-default account (the default one
 * publishes the original price), and never the ending another account already uses,
 * so duplicates of one product never share a price. Queued duplicates are repriced.
 */
export async function patchAccountPriceEnding(req: Request, res: Response) {
  const priceEnding = parseBody(req, res)
  if (priceEnding == null) return
  const prisma = requirePrisma(res)
  if (!prisma) return
  const account = await editableAccount(prisma, res, accountIdFrom(req), priceEnding)
  if (!account) return
  const { updated, repriced } = await prisma.$transaction(
    async (tx) => ({
      updated: await tx.account.update({ where: { id: account.id }, data: { priceEnding } }),
      repriced: await repriceQueuedDuplicates(tx, account.id, priceEnding),
    }),
    { timeout: 30_000 },
  )
  log("info", "account_price_ending_changed", { accountId: account.id, from: account.priceEnding, to: priceEnding, repriced })
  res.json({ account: toAccountJson(updated), repriced })
}
