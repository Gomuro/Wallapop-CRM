import type { Request, Response } from "express"

export type ApiErrorBody = {
  error: {
    code: string
    message: string
  }
}

export function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
) {
  const body: ApiErrorBody = { error: { code, message } }
  return res.status(status).json(body)
}

export function notImplemented(_req: Request, res: Response) {
  return sendError(
    res,
    501,
    "NOT_IMPLEMENTED",
    "This endpoint is specified in server/API.md and lands in issues #55–#65.",
  )
}
