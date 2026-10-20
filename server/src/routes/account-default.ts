import type { Request, Response } from "express"

import { autopostIntervalPatchSchema, autopostIntervalToMs } from "../../../lib/validations/account"
import { sendError } from "../lib/http-error"
import { log, serializeError } from "../lib/log"
import { linkQueuedListingsAlreadyLive } from "../lib/wallapop-already-live"
import {
  pauseAutopostSchedule,
  rescheduleAutopostLoop,
} from "../lib/wallapop-autopost"
import { abortInFlightPublish } from "../lib/wallapop-cdp"
import { getWallapopSession } from "../lib/wallapop-session"
import { rejectedZod, requirePrisma, sendAccountPayload } from "./account-http"

async function loadDefaultAccount(res: Response) {
  const prisma = requirePrisma(res)
  if (!prisma) return null
  const account = await prisma.account.findFirst({ where: { isDefault: true } })
  if (!account) {
    sendError(res, 404, "NOT_FOUND", "Default account is not configured.")
    return null
  }
  return { prisma, account }
}

export async function getDefaultAccount(_req: Request, res: Response) {
  const loaded = await loadDefaultAccount(res)
  if (!loaded) return
  await sendAccountPayload(res, loaded.prisma, loaded.account)
}

export async function patchDefaultAccountAutopost(req: Request, res: Response) {
  let body: ReturnType<typeof autopostIntervalPatchSchema.parse>
  try {
    body = autopostIntervalPatchSchema.parse(req.body)
  } catch (error) {
    if (rejectedZod(res, error)) return
    throw error
  }
  const loaded = await loadDefaultAccount(res)
  if (!loaded) return
  const updated = await loaded.prisma.account.update({
    where: { id: loaded.account.id },
    data: { autopostIntervalMs: autopostIntervalToMs(body.value, body.unit) },
  })
  await rescheduleAutopostLoop()
  await sendAccountPayload(res, loaded.prisma, updated)
}

async function sweepAlreadyLive(prisma: NonNullable<ReturnType<typeof requirePrisma>>) {
  try {
    await linkQueuedListingsAlreadyLive(prisma)
  } catch (error) {
    log("warn", "wallapop_already_live_sweep_failed", serializeError(error))
  }
}

export async function startDefaultAccountAutopost(_req: Request, res: Response) {
  const session = getWallapopSession()
  if (session.status !== "ACTIVE") {
    sendError(
      res,
      409,
      "NOT_ACTIVE",
      "Conecta la cuenta de Wallapop antes de iniciar el autopost.",
    )
    return
  }
  const prisma = requirePrisma(res)
  if (!prisma) return
  const updated = await prisma.account.updateMany({
    where: { isDefault: true },
    data: { autopostEnabled: true },
  })
  if (updated.count === 0) {
    sendError(res, 404, "NOT_FOUND", "Default account is not configured.")
    return
  }
  await sweepAlreadyLive(prisma)
  await rescheduleAutopostLoop()
  const loaded = await loadDefaultAccount(res)
  if (!loaded) return
  await sendAccountPayload(res, loaded.prisma, loaded.account)
}

export async function stopDefaultAccountAutopost(_req: Request, res: Response) {
  const prisma = requirePrisma(res)
  if (!prisma) return
  const updated = await prisma.account.updateMany({
    where: { isDefault: true },
    data: { autopostEnabled: false },
  })
  if (updated.count === 0) {
    sendError(res, 404, "NOT_FOUND", "Default account is not configured.")
    return
  }
  await abortInFlightPublish()
  pauseAutopostSchedule()
  const loaded = await loadDefaultAccount(res)
  if (!loaded) return
  await sendAccountPayload(res, loaded.prisma, loaded.account)
}
