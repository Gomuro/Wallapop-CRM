import type { Request, Response } from "express"

import { sendError } from "../lib/http-error"
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
