import type { Request, Response } from "express"

import {
  accountCreateSchema,
  type AccountCreateInput,
} from "../../../lib/validations/account"
import { assignChromePlaces, nextChromeSlot } from "../lib/account-chrome"
import { sendError } from "../lib/http-error"
import { isUniqueConstraint } from "../lib/prisma-error"
import {
  rejectedZod,
  requirePrisma,
  toAccountJson,
  withChromePlace,
} from "./account-http"

export async function listAccounts(_req: Request, res: Response) {
  const prisma = requirePrisma(res)
  if (!prisma) return
  const accounts = await prisma.account.findMany({
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  })
  const places = assignChromePlaces(accounts)
  res.json({
    accounts: accounts.map((row) => withChromePlace(toAccountJson(row), places)),
  })
}

async function insertAccount(
  prisma: NonNullable<ReturnType<typeof requirePrisma>>,
  body: AccountCreateInput,
) {
  return prisma.$transaction(async (tx) => {
    const taken = await tx.account.findMany({ select: { chromeSlot: true } })
    return tx.account.create({
      data: {
        name: body.name,
        status: body.status,
        isDefault: false,
        city: body.city ?? null,
        postalCode: body.postalCode ?? null,
        chromeSlot: nextChromeSlot(taken.map((row) => row.chromeSlot)),
      },
    })
  })
}

/** CRM row only. Does not open Chrome and does not write ProductListing. */
export async function createAccount(req: Request, res: Response) {
  let body: ReturnType<typeof accountCreateSchema.parse>
  try {
    body = accountCreateSchema.parse(req.body)
  } catch (error) {
    if (rejectedZod(res, error)) return
    throw error
  }
  const prisma = requirePrisma(res)
  if (!prisma) return
  const created = await createAccountRow(prisma, body, res)
  if (!created) return
  const accounts = await prisma.account.findMany({
    select: { id: true, chromeSlot: true },
  })
  res.status(201).json({
    account: withChromePlace(toAccountJson(created), assignChromePlaces(accounts)),
  })
}

async function createAccountRow(
  prisma: NonNullable<ReturnType<typeof requirePrisma>>,
  body: ReturnType<typeof accountCreateSchema.parse>,
  res: Response,
) {
  try {
    return await insertAccount(prisma, body)
  } catch (error) {
    if (isUniqueConstraint(error)) {
      sendError(res, 409, "CHROME_SLOT", "No se pudo crear la cuenta. Inténtalo otra vez.")
      return null
    }
    throw error
  }
}
