import type { Request, Response } from "express"

import type { PrismaClient } from "../../generated/prisma/client"
import { autopostIntervalPatchSchema, autopostIntervalToMs } from "../../../lib/validations/account"
import { chromePortForAccount } from "../lib/account-chrome"
import { sendError } from "../lib/http-error"
import { log, serializeError } from "../lib/log"
import { linkQueuedListingsAlreadyLive } from "../lib/wallapop-already-live"
import {
  pauseAccountAutopost,
  pauseAutopostSchedule,
  rescheduleAutopostLoop,
  scheduleAccountAutopost,
} from "../lib/wallapop-autopost"
import { abortInFlightPublish } from "../lib/wallapop-cdp"
import { peekWallapopSession } from "../lib/wallapop-session"
import {
  accountIdFrom,
  rejectedZod,
  requirePrisma,
  restrictionBlocksStart,
  sendAccountPayload,
} from "./account-http"

async function loadAccount(res: Response, accountId: string) {
  const prisma = requirePrisma(res)
  if (!prisma) return null
  const account = await prisma.account.findUnique({ where: { id: accountId } })
  if (!account) {
    sendError(res, 404, "NOT_FOUND", "Cuenta no encontrada.")
    return null
  }
  return { prisma, account }
}

function missingAccount(res: Response, accountId: string | undefined): accountId is undefined {
  if (accountId) return false
  sendError(res, 404, "NOT_FOUND", "Cuenta no encontrada.")
  return true
}

export async function getAccountAutopost(req: Request, res: Response) {
  const accountId = accountIdFrom(req)
  if (missingAccount(res, accountId)) return
  const loaded = await loadAccount(res, accountId)
  if (!loaded) return
  await sendAccountPayload(res, loaded.prisma, loaded.account, loaded.account.id)
}

export async function patchAccountAutopost(req: Request, res: Response) {
  const accountId = accountIdFrom(req)
  if (missingAccount(res, accountId)) return
  let body: ReturnType<typeof autopostIntervalPatchSchema.parse>
  try {
    body = autopostIntervalPatchSchema.parse(req.body)
  } catch (error) {
    if (rejectedZod(res, error)) return
    throw error
  }
  const loaded = await loadAccount(res, accountId)
  if (!loaded) return
  const updated = await loaded.prisma.account.update({
    where: { id: loaded.account.id },
    data: { autopostIntervalMs: autopostIntervalToMs(body.value, body.unit) },
  })
  await refreshAccountSchedule(updated)
  await sendAccountPayload(res, loaded.prisma, updated, updated.id)
}

async function refreshAccountSchedule(account: { id: string; isDefault: boolean; autopostEnabled: boolean }) {
  if (account.isDefault) await rescheduleAutopostLoop()
  else if (account.autopostEnabled) await scheduleAccountAutopost(account.id)
}

async function sweepAlreadyLive(prisma: PrismaClient) {
  try {
    await linkQueuedListingsAlreadyLive(prisma)
  } catch (error) {
    log("warn", "wallapop_already_live_sweep_failed", serializeError(error))
  }
}

export async function startAccountAutopost(req: Request, res: Response) {
  const accountId = accountIdFrom(req)
  if (missingAccount(res, accountId)) return
  if (peekWallapopSession(accountId).status !== "ACTIVE") {
    sendError(res, 409, "NOT_ACTIVE", "Conecta la cuenta de Wallapop antes de iniciar el autopost.")
    return
  }
  const loaded = await loadAccount(res, accountId)
  if (!loaded) return
  if (restrictionBlocksStart(res, loaded.account)) return
  const updated = await loaded.prisma.account.update({
    where: { id: loaded.account.id },
    data: { autopostEnabled: true },
  })
  if (updated.isDefault) {
    await sweepAlreadyLive(loaded.prisma)
    await rescheduleAutopostLoop()
  } else {
    await scheduleAccountAutopost(updated.id)
  }
  await sendAccountPayload(res, loaded.prisma, updated, updated.id)
}

export async function stopAccountAutopost(req: Request, res: Response) {
  const accountId = accountIdFrom(req)
  if (missingAccount(res, accountId)) return
  const loaded = await loadAccount(res, accountId)
  if (!loaded) return
  const updated = await loaded.prisma.account.update({
    where: { id: loaded.account.id },
    data: { autopostEnabled: false },
  })
  await pauseAccountSchedule(updated)
  await sendAccountPayload(res, loaded.prisma, updated, updated.id)
}

async function pauseAccountSchedule(account: { id: string; isDefault: boolean }) {
  if (account.isDefault) {
    await abortInFlightPublish()
    pauseAutopostSchedule()
    return
  }
  await abortInFlightPublish(await chromePortForAccount(account.id))
  pauseAccountAutopost(account.id)
}
