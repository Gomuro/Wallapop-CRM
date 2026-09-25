import type { NextFunction, Request, Response } from "express"

import { sendError } from "../lib/http-error"
import { readSessionToken, verifySessionToken } from "../lib/session"

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = readSessionToken(req)
  if (!token) {
    sendError(res, 401, "UNAUTHORIZED", "Sign in required.")
    return
  }
  try {
    const payload = verifySessionToken(token)
    req.user = { id: payload.sub, email: payload.email, name: "" }
    next()
  } catch {
    sendError(res, 401, "UNAUTHORIZED", "Sign in required.")
  }
}
