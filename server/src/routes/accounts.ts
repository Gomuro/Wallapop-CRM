import type { Request, Response } from "express"
import { ZodError } from "zod"

import {
  autopostIntervalPatchSchema,
  autopostIntervalToMs,
  wallapop2faSchema,
  wallapopConnectSchema,
} from "../../../lib/validations/account"
import { getPrisma } from "../lib/db"
import { sendError } from "../lib/http-error"
import {
  loadAutopostStatus,
  rescheduleAutopostLoop,
} from "../lib/wallapop-autopost"
import {
  connectWallapopSession,
  disconnectWallapopSession,
  getWallapopSession,
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
  autopostIntervalMs: number | null
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
    autopostIntervalMs: row.autopostIntervalMs,
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
    ...(session.listingsReset ? { listingsReset: true } : {}),
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

  const autopost = await loadAutopostStatus(prisma)
  res.json({
    account: toAccountJson(account),
    autopost,
  })
}

export async function patchDefaultAccountAutopost(req: Request, res: Response) {
  let body: { value: number; unit: "seconds" | "minutes" | "hours" | "days" }
  try {
    body = autopostIntervalPatchSchema.parse(req.body)
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

  const intervalMs = autopostIntervalToMs(body.value, body.unit)
  const updated = await prisma.account.update({
    where: { id: account.id },
    data: { autopostIntervalMs: intervalMs },
  })

  await rescheduleAutopostLoop()
  const autopost = await loadAutopostStatus(prisma)
  res.json({
    account: toAccountJson(updated),
    autopost,
  })
}

async function jsonDefaultAutopost(res: Response) {
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
  res.json({
    account: toAccountJson(account),
    autopost: await loadAutopostStatus(prisma),
  })
}

export async function startDefaultAccountAutopost(
  _req: Request,
  res: Response,
) {
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

  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "Database is not configured.")
    return
  }

  const updated = await prisma.account.updateMany({
    where: { isDefault: true },
    data: { autopostEnabled: true },
  })
  if (updated.count === 0) {
    sendError(res, 404, "NOT_FOUND", "Default account is not configured.")
    return
  }

  await rescheduleAutopostLoop()
  await jsonDefaultAutopost(res)
}

export async function stopDefaultAccountAutopost(
  _req: Request,
  res: Response,
) {
  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "Database is not configured.")
    return
  }

  const updated = await prisma.account.updateMany({
    where: { isDefault: true },
    data: { autopostEnabled: false },
  })
  if (updated.count === 0) {
    sendError(res, 404, "NOT_FOUND", "Default account is not configured.")
    return
  }

  await jsonDefaultAutopost(res)
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
