import type { NextFunction, Request, Response } from "express"

import { sendError } from "../lib/http-error"

export function notFoundHandler(_req: Request, res: Response) {
  sendError(res, 404, "NOT_FOUND", "Not found")
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  console.error(err)
  sendError(res, 500, "INTERNAL", "Internal server error")
}
