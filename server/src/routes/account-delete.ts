import type { Request, Response } from "express"

import type { PrismaClient } from "../../generated/prisma/client"
import { chromePortForAccount } from "../lib/account-chrome"
import { sendError } from "../lib/http-error"
import { log } from "../lib/log"
import {
  pauseAccountAutopost,
  pauseAutopostSchedule,
  rescheduleAutopostLoop,
  scheduleAccountAutopost,
} from "../lib/wallapop-autopost"
import {
  closeWallapopBrowser,
  getBrowserBusy,
  isBrowserBusyError,
  setKeepChromeWarm,
} from "../lib/wallapop-cdp"
import { dropWallapopSession } from "../lib/wallapop-session"
import { accountIdFrom, requirePrisma } from "./account-http"

const LAST_ACCOUNT_MESSAGE =
  "Tiene que quedar al menos una cuenta. Si esta está bloqueada, desconéctala e inicia sesión con el email nuevo en esta misma ficha."

type DeletableAccount = { id: string; isDefault: boolean; port: number }

async function restorePausedAutopost(wasDefault: boolean, accountId: string) {
  if (wasDefault) await rescheduleAutopostLoop()
  else await scheduleAccountAutopost(accountId)
}

async function loadDeletableAccount(
  res: Response,
  prisma: PrismaClient,
  accountId: string,
): Promise<DeletableAccount | null> {
  const total = await prisma.account.count()
  if (total <= 1) {
    sendError(res, 409, "LAST_ACCOUNT", LAST_ACCOUNT_MESSAGE)
    return null
  }
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { id: true, isDefault: true },
  })
  if (!account) {
    sendError(res, 404, "NOT_FOUND", "Cuenta no encontrada.")
    return null
  }
  const port = await chromePortForAccount(account.id)
  if (getBrowserBusy(port) !== "idle") {
    sendError(
      res,
      409,
      "BROWSER_BUSY",
      "Esta cuenta está usando Chrome. Espera a que termine y vuelve a borrar.",
    )
    return null
  }
  return { ...account, port }
}

async function closeAccountChrome(account: DeletableAccount) {
  if (account.isDefault) pauseAutopostSchedule()
  else pauseAccountAutopost(account.id)
  setKeepChromeWarm(false, account.port)
  try {
    await closeWallapopBrowser(account.port)
  } catch (error) {
    await restorePausedAutopost(account.isDefault, account.id)
    throw error
  }
}

async function promoteNextDefault(
  tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
  accountId: string,
) {
  const next = await tx.account.findFirst({
    where: { id: { not: accountId } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  })
  if (!next) throw new Error("LAST_ACCOUNT")
  pauseAccountAutopost(next.id)
  await tx.account.update({
    where: { id: accountId },
    data: { isDefault: false, autopostEnabled: false },
  })
  await tx.account.update({
    where: { id: next.id },
    data: { isDefault: true },
  })
  return next.id
}

async function removeAccountRow(prisma: PrismaClient, account: DeletableAccount) {
  return prisma.$transaction(async (tx) => {
    const nextId = account.isDefault ? await promoteNextDefault(tx, account.id) : null
    await tx.account.delete({ where: { id: account.id } })
    return nextId
  })
}

/** Remove the CRM card. Warehouse products stay. Wallapop ads are not deleted. */
export async function deleteAccount(req: Request, res: Response) {
  const accountId = accountIdFrom(req)
  if (!accountId) {
    sendError(res, 404, "NOT_FOUND", "Cuenta no encontrada.")
    return
  }
  const prisma = requirePrisma(res)
  if (!prisma) return
  const account = await loadDeletableAccount(res, prisma, accountId)
  if (!account) return
  const removed = await deleteLoadedAccount(res, prisma, account)
  if (!removed) return
  if (removed.promotedId) await rescheduleAutopostLoop()
  log("info", "account_deleted", { accountId: account.id, promotedId: removed.promotedId })
  res.json({ ok: true })
}

async function deleteLoadedAccount(
  res: Response,
  prisma: PrismaClient,
  account: DeletableAccount,
) {
  try {
    await closeAccountChrome(account)
  } catch (error) {
    if (isBrowserBusyError(error)) {
      sendError(res, 409, "BROWSER_BUSY", error.message)
      return null
    }
    throw error
  }
  dropWallapopSession(account.id)
  try {
    const promotedId = await removeAccountRow(prisma, account)
    return { promotedId }
  } catch (error) {
    await restorePausedAutopost(account.isDefault, account.id)
    if (error instanceof Error && error.message === "LAST_ACCOUNT") {
      sendError(res, 409, "LAST_ACCOUNT", LAST_ACCOUNT_MESSAGE)
      return null
    }
    throw error
  }
}
