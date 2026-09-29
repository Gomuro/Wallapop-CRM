import type { Request, Response } from "express"
import { ZodError } from "zod"

import {
  wallapop2faSchema,
  wallapopConnectSchema,
} from "../../../lib/validations/account"
import { getPrisma } from "../lib/db"
import { sendError } from "../lib/http-error"
import {
  connectWallapopSession,
  disconnectWallapopSession,
  getWallapopSessionSnapshot,
  submitWallapopSession2fa,
  type WallapopSessionSnapshot,
} from "../lib/wallapop-session"
import { isBrowserBusyError } from "../lib/wallapop-cdp"

function toAccountJson(row: {
  id: string
  name: string
  status: string
  isDefault: boolean
  city: string | null
  postalCode: string | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    isDefault: row.isDefault,
    city: row.city,
    postalCode: row.postalCode,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toSessionJson(session: WallapopSessionSnapshot) {
  return {
    status: session.status,
    requires2FA: session.requires2FA,
    email: session.email,
    ...(session.error ? { error: session.error } : {}),
  }
}

export async function getDefaultAccount(_req: Request, res: Response) {
  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "Database is not configured.")
    return
  }

  const account = await prisma.account.findFirst({
    where: { isDefault: true },
  })

  if (!account) {
    sendError(res, 404, "NOT_FOUND", "Default account is not configured.")
    return
  }

  res.json({ account: toAccountJson(account) })
}

export async function getAccountConnectionStatus(_req: Request, res: Response) {
  res.json(toSessionJson(await getWallapopSessionSnapshot()))
}

export async function connectAccount(req: Request, res: Response) {
  let body: { email: string; password: string; proxy: string | null }
  try {
    body = wallapopConnectSchema.parse(req.body)
  } catch (error) {
    if (error instanceof ZodError) {
      sendError(
        res,
        400,
        "VALIDATION_ERROR",
        error.issues[0]?.message ?? "Invalid body.",
      )
      return
    }
    throw error
  }

  const result = await connectWallapopSession({
    email: body.email,
    password: body.password,
    proxy: body.proxy,
  })

  if (!result.ok) {
    const status = result.code === "BROWSER_BUSY" ? 409 : 400
    const code = result.code === "BROWSER_BUSY" ? "BROWSER_BUSY" : "CONNECT_FAILED"
    sendError(res, status, code, result.message)
    return
  }

  res.json(toSessionJson(result.session))
}

export async function connectAccount2fa(req: Request, res: Response) {
  let body: { code: string }
  try {
    body = wallapop2faSchema.parse(req.body)
  } catch (error) {
    if (error instanceof ZodError) {
      sendError(
        res,
        400,
        "VALIDATION_ERROR",
        error.issues[0]?.message ?? "Invalid body.",
      )
      return
    }
    throw error
  }

  const result = await submitWallapopSession2fa(body.code)
  if (!result.ok) {
    const status =
      result.code === "NOT_AUTHENTICATING" || result.code === "BROWSER_BUSY"
        ? 409
        : 400
    sendError(res, status, result.code, result.message)
    return
  }

  res.json(toSessionJson(result.session))
}

export async function disconnectAccount(_req: Request, res: Response) {
  try {
    const session = await disconnectWallapopSession()
    res.json(toSessionJson(session))
  } catch (error) {
    if (isBrowserBusyError(error)) {
      sendError(res, 409, "BROWSER_BUSY", error.message)
      return
    }
    throw error
  }
}
