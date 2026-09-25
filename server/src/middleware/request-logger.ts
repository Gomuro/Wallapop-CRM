import type { NextFunction, Request, Response } from "express"

import { log } from "../lib/log"

const SKIP = new Set(["/health", "/api/health"])

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  if (SKIP.has(req.path)) {
    next()
    return
  }

  const start = Date.now()
  res.on("finish", () => {
    const status = res.statusCode
    const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info"
    log(level, "request", {
      method: req.method,
      path: req.originalUrl,
      status,
      ms: Date.now() - start,
    })
  })
  next()
}
