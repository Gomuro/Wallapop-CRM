import type { Request, Response } from "express"

import {
  wallapop2faSchema,
  wallapopConnectSchema,
  wallapopProxySchema,
} from "../../../lib/validations/account"
import { sendError } from "../lib/http-error"
import { isBrowserBusyError } from "../lib/wallapop-cdp"
import {
  connectWallapopSession,
  disconnectWallapopSession,
  getWallapopSessionSnapshot,
  submitWallapopSession2fa,
} from "../lib/wallapop-session"
import { applyWallapopChromeProxy } from "../lib/wallapop-session/proxy"
import { readAccountId, rejectedZod, toSessionJson } from "./account-http"

export async function getAccountConnectionStatus(req: Request, res: Response) {
  res.json(toSessionJson(await getWallapopSessionSnapshot(readAccountId(req.query.accountId))))
}

export async function connectAccount(req: Request, res: Response) {
  let body: ReturnType<typeof wallapopConnectSchema.parse>
  try {
    body = wallapopConnectSchema.parse(req.body)
  } catch (error) {
    if (rejectedZod(res, error)) return
    throw error
  }
  const result = await connectWallapopSession({
    email: body.email,
    password: body.password,
    proxy: body.proxy,
    accountId: body.accountId,
  })
  if (!result.ok) {
    const status = result.code === "BROWSER_BUSY" ? 409 : 400
    const code = result.code === "BROWSER_BUSY" ? "BROWSER_BUSY" : "CONNECT_FAILED"
    sendError(res, status, code, result.message)
    return
  }
  res.json(toSessionJson(result.session))
}

function twoFaConflict(code: string) {
  return code === "NOT_AUTHENTICATING" || code === "BROWSER_BUSY"
}

export async function connectAccount2fa(req: Request, res: Response) {
  let body: ReturnType<typeof wallapop2faSchema.parse>
  try {
    body = wallapop2faSchema.parse(req.body)
  } catch (error) {
    if (rejectedZod(res, error)) return
    throw error
  }
  const result = await submitWallapopSession2fa(body.code, body.accountId)
  if (!result.ok) {
    sendError(res, twoFaConflict(result.code) ? 409 : 400, result.code, result.message)
    return
  }
  res.json(toSessionJson(result.session))
}

export async function applyAccountProxy(req: Request, res: Response) {
  let body: ReturnType<typeof wallapopProxySchema.parse>
  try {
    body = wallapopProxySchema.parse(req.body)
  } catch (error) {
    if (rejectedZod(res, error)) return
    throw error
  }
  try {
    const session = await applyWallapopChromeProxy({
      proxy: body.proxy,
      accountId: body.accountId ?? readAccountId(req.body?.accountId),
    })
    res.json(toSessionJson(session))
  } catch (error) {
    if (isBrowserBusyError(error)) {
      sendError(res, 409, "BROWSER_BUSY", error.message)
      return
    }
    throw error
  }
}

export async function disconnectAccount(req: Request, res: Response) {
  try {
    const session = await disconnectWallapopSession(readAccountId(req.body?.accountId))
    res.json(toSessionJson(session))
  } catch (error) {
    if (isBrowserBusyError(error)) {
      sendError(res, 409, "BROWSER_BUSY", error.message)
      return
    }
    throw error
  }
}
