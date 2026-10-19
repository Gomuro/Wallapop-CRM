import type { Request, Response } from "express"

import { assignChromePlaces } from "../lib/account-chrome"
import { getPrisma } from "../lib/db"
import { sendError } from "../lib/http-error"
import { log, serializeError } from "../lib/log"
import { openDevWatchWindow } from "../lib/wallapop-cdp"
import {
  devMonitorControlsEnabled,
  isLoopbackRequest,
  writeDevMonitorEnabled,
} from "../lib/wallapop-monitor/dev-switch"
import {
  isWallapopMonitorEnabled,
  setWallapopMonitorEnabled,
} from "../lib/wallapop-monitor/loop"

function allowed(req: Request, res: Response): boolean {
  if (devMonitorControlsEnabled() && isLoopbackRequest(req)) return true
  sendError(res, 404, "NOT_FOUND", "Not found.")
  return false
}

export function getDevMonitor(req: Request, res: Response) {
  if (!allowed(req, res)) return
  res.json({ enabled: isWallapopMonitorEnabled() })
}

export function putDevMonitor(req: Request, res: Response) {
  if (!allowed(req, res)) return
  const enabled = (req.body as { enabled?: unknown } | undefined)?.enabled
  if (typeof enabled !== "boolean") {
    sendError(res, 400, "VALIDATION_ERROR", "enabled must be a boolean.")
    return
  }
  writeDevMonitorEnabled(enabled)
  res.json({ enabled: setWallapopMonitorEnabled(enabled) })
}

export async function postDevAccountWatch(req: Request, res: Response) {
  if (!allowed(req, res)) return
  const accountId = req.params.id
  if (typeof accountId !== "string" || accountId.length === 0) {
    sendError(res, 400, "VALIDATION_ERROR", "Falta la cuenta.")
    return
  }
  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "Database is not configured.")
    return
  }
  const accounts = await prisma.account.findMany({
    select: { id: true, chromeSlot: true },
  })
  const port = assignChromePlaces(accounts).get(accountId)?.port
  if (port == null) {
    sendError(res, 404, "NOT_FOUND", "Cuenta no encontrada.")
    return
  }
  try {
    await openDevWatchWindow(port)
  } catch (error) {
    log("warn", "wallapop_dev_watch_failed", {
      port,
      err: serializeError(error),
    })
    sendError(res, 500, "INTERNAL", "No se pudo abrir la ventana de Chrome.")
    return
  }
  res.json({ ok: true, port })
}
