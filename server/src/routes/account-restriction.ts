import type { Request, Response } from "express"

import { sendError } from "../lib/http-error"
import { dismissRestriction } from "../lib/wallapop-restriction"
import {
  accountIdFrom,
  requirePrisma,
  sendAccountPayload,
} from "./account-http"

/** Operator says the suspicion is wrong (or fixed). Autopost stays stopped. */
export async function dismissAccountRestriction(req: Request, res: Response) {
  const accountId = accountIdFrom(req)
  const prisma = requirePrisma(res)
  if (!prisma) return
  const account = accountId
    ? await prisma.account.findUnique({ where: { id: accountId } })
    : null
  if (!account) {
    sendError(res, 404, "NOT_FOUND", "Cuenta no encontrada.")
    return
  }
  await dismissRestriction(prisma, account.id)
  const updated = await prisma.account.findUniqueOrThrow({
    where: { id: account.id },
  })
  await sendAccountPayload(res, prisma, updated, updated.id)
}
