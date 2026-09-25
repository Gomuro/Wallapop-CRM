import type { NextFunction, Request, Response } from "express"
import multer from "multer"

import { sendError } from "../lib/http-error"
import { log, serializeError } from "../lib/log"

export function notFoundHandler(_req: Request, res: Response) {
  sendError(res, 404, "NOT_FOUND", "Not found")
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "Image must be 10MB or smaller."
        : err.code === "LIMIT_FILE_COUNT"
          ? "At most 10 files per request."
          : err.message
    sendError(res, 400, "VALIDATION_ERROR", message)
    return
  }
  log("error", "unhandled", {
    method: req.method,
    path: req.originalUrl,
    err: serializeError(err),
  })
  sendError(res, 500, "INTERNAL", "Internal server error")
}
