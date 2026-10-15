import fs from "node:fs"
import path from "node:path"

import type { Request } from "express"

const filePath = path.resolve(process.cwd(), "tmp/dev-monitor.json")

export function devMonitorControlsEnabled(): boolean {
  return process.env.WALLAPOP_DEV_CONTROLS === "1"
}

export function isLoopbackRequest(req: Request): boolean {
  const address = req.socket.remoteAddress ?? ""
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address.endsWith("127.0.0.1")
  )
}

/** Local switch only. Without WALLAPOP_DEV_CONTROLS the monitor stays on. */
export function readDevMonitorEnabled(): boolean {
  if (!devMonitorControlsEnabled()) return true
  try {
    const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")
    const parsed = JSON.parse(raw) as { enabled?: unknown }
    if (typeof parsed.enabled === "boolean") return parsed.enabled
  } catch {
    return true
  }
  return true
}

export function writeDevMonitorEnabled(enabled: boolean): void {
  if (!devMonitorControlsEnabled()) return
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify({ enabled }))
}
