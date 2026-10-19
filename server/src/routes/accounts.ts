import type { Request, Response } from "express"
import { ZodError } from "zod"

import {
  accountCreateSchema,
  autopostIntervalPatchSchema,
  autopostIntervalToMs,
  wallapop2faSchema,
  wallapopConnectSchema,
} from "../../../lib/validations/account"
import {
  assignChromePlaces,
  chromePortForAccount,
  nextChromeSlot,
} from "../lib/account-chrome"
import { getPrisma } from "../lib/db"
import { sendError } from "../lib/http-error"
import { isUniqueConstraint } from "../lib/prisma-error"
import { log, serializeError } from "../lib/log"
import { linkQueuedListingsAlreadyLive } from "../lib/wallapop-already-live"
import {
  loadAutopostStatus,
  pauseAccountAutopost,
  pauseAutopostSchedule,
  rescheduleAutopostLoop,
  scheduleAccountAutopost,
} from "../lib/wallapop-autopost"
import {
  connectWallapopSession,
  disconnectWallapopSession,
  dropWallapopSession,
  getWallapopSession,
  getWallapopSessionSnapshot,
  peekWallapopSession,
  submitWallapopSession2fa,
  type WallapopSessionSnapshot,
} from "../lib/wallapop-session"
import {
  abortInFlightPublish,
  closeWallapopBrowser,
  getBrowserBusy,
  isBrowserBusyError,
  setKeepChromeWarm,
} from "../lib/wallapop-cdp"
import { listWorkerJobs } from "../lib/wallapop-worker-jobs"

function toAccountJson(row: {
  id: string
  name: string
  status: string
  isDefault: boolean
  city: string | null
  postalCode: string | null
  autopostIntervalMs: number | null
  autopostEnabled: boolean
  wallapopEmail: string | null
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
    autopostEnabled: row.autopostEnabled,
    wallapopEmail: row.wallapopEmail,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function withChromePlace<T extends { id: string }>(
  row: T,
  places: Map<string, { port: number; profileName: string }>,
) {
  const place = places.get(row.id)
  return {
    ...row,
    cdpPort: place?.port ?? 9222,
    profileName: place?.profileName ?? "ChromeCDP-Persistent",
  }
}

export async function listAccounts(_req: Request, res: Response) {
  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "Database is not configured.")
    return
  }
  const accounts = await prisma.account.findMany({
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  })
  const places = assignChromePlaces(accounts)
  res.json({
    accounts: accounts.map((row) => withChromePlace(toAccountJson(row), places)),
  })
}

/** CRM row only. Does not open Chrome and does not write ProductListing. */
export async function createAccount(req: Request, res: Response) {
  let body: ReturnType<typeof accountCreateSchema.parse>
  try {
    body = accountCreateSchema.parse(req.body)
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

  let created
  try {
    created = await prisma.$transaction(async (tx) => {
      const taken = await tx.account.findMany({ select: { chromeSlot: true } })
      return tx.account.create({
        data: {
          name: body.name,
          status: body.status,
          isDefault: false,
          city: body.city ?? null,
          postalCode: body.postalCode ?? null,
          chromeSlot: nextChromeSlot(taken.map((row) => row.chromeSlot)),
        },
      })
    })
  } catch (error) {
    if (isUniqueConstraint(error)) {
      sendError(res, 409, "CHROME_SLOT", "No se pudo crear la cuenta. Inténtalo otra vez.")
      return
    }
    throw error
  }
  const accounts = await prisma.account.findMany({
    select: { id: true, chromeSlot: true },
  })
  res.status(201).json({
    account: withChromePlace(toAccountJson(created), assignChromePlaces(accounts)),
  })
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
    workers: listWorkerJobs(),
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
    workers: listWorkerJobs(),
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
    workers: listWorkerJobs(),
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

  try {
    await linkQueuedListingsAlreadyLive(prisma)
  } catch (error) {
    log("warn", "wallapop_already_live_sweep_failed", serializeError(error))
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

  await abortInFlightPublish()
  pauseAutopostSchedule()
  await jsonDefaultAutopost(res)
}

function readAccountId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export async function getAccountConnectionStatus(req: Request, res: Response) {
  res.json(toSessionJson(await getWallapopSessionSnapshot(readAccountId(req.query.accountId))))
}

export async function connectAccount(req: Request, res: Response) {
  let body: {
    accountId?: string
    email: string
    password: string
    proxy: string | null
  }
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

export async function connectAccount2fa(req: Request, res: Response) {
  let body: { accountId?: string; code: string }
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

  const result = await submitWallapopSession2fa(body.code, body.accountId)
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

async function restorePausedAutopost(wasDefault: boolean, accountId: string) {
  if (wasDefault) await rescheduleAutopostLoop()
  else await scheduleAccountAutopost(accountId)
}

const LAST_ACCOUNT_MESSAGE =
  "Tiene que quedar al menos una cuenta. Si esta está bloqueada, desconéctala e inicia sesión con el email nuevo en esta misma ficha."

/** Remove the CRM card. Warehouse products stay. Wallapop ads are not deleted. */
export async function deleteAccount(req: Request, res: Response) {
  const accountId = routeAccountId(req.params.id)
  if (!accountId) {
    sendError(res, 404, "NOT_FOUND", "Cuenta no encontrada.")
    return
  }
  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "Database is not configured.")
    return
  }
  const total = await prisma.account.count()
  if (total <= 1) {
    sendError(res, 409, "LAST_ACCOUNT", LAST_ACCOUNT_MESSAGE)
    return
  }
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { id: true, isDefault: true },
  })
  if (!account) {
    sendError(res, 404, "NOT_FOUND", "Cuenta no encontrada.")
    return
  }
  const port = await chromePortForAccount(account.id)
  if (getBrowserBusy(port) !== "idle") {
    sendError(
      res,
      409,
      "BROWSER_BUSY",
      "Esta cuenta está usando Chrome. Espera a que termine y vuelve a borrar.",
    )
    return
  }
  const wasDefault = account.isDefault
  if (wasDefault) pauseAutopostSchedule()
  else pauseAccountAutopost(account.id)
  setKeepChromeWarm(false, port)
  try {
    await closeWallapopBrowser(port)
  } catch (error) {
    await restorePausedAutopost(wasDefault, account.id)
    if (isBrowserBusyError(error)) {
      sendError(res, 409, "BROWSER_BUSY", error.message)
      return
    }
    throw error
  }
  dropWallapopSession(account.id)
  let promotedId: string | null = null
  try {
    promotedId = await prisma.$transaction(async (tx) => {
      let nextId: string | null = null
      if (account.isDefault) {
        const next = await tx.account.findFirst({
          where: { id: { not: account.id } },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        })
        if (!next) throw new Error("LAST_ACCOUNT")
        nextId = next.id
        pauseAccountAutopost(next.id)
        await tx.account.update({
          where: { id: account.id },
          data: { isDefault: false, autopostEnabled: false },
        })
        await tx.account.update({
          where: { id: next.id },
          data: { isDefault: true },
        })
      }
      await tx.account.delete({ where: { id: account.id } })
      return nextId
    })
  } catch (error) {
    await restorePausedAutopost(wasDefault, account.id)
    if (error instanceof Error && error.message === "LAST_ACCOUNT") {
      sendError(res, 409, "LAST_ACCOUNT", LAST_ACCOUNT_MESSAGE)
      return
    }
    throw error
  }
  if (promotedId) await rescheduleAutopostLoop()
  log("info", "account_deleted", { accountId: account.id, promotedId })
  res.json({ ok: true })
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

function routeAccountId(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

async function jsonAccountAutopost(res: Response, accountId: string) {
  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "Database is not configured.")
    return
  }
  const account = await prisma.account.findUnique({ where: { id: accountId } })
  if (!account) {
    sendError(res, 404, "NOT_FOUND", "Cuenta no encontrada.")
    return
  }
  res.json({
    account: toAccountJson(account),
    autopost: await loadAutopostStatus(prisma, account.id),
    workers: listWorkerJobs(),
  })
}

export async function getAccountAutopost(req: Request, res: Response) {
  const accountId = routeAccountId(req.params.id)
  if (!accountId) {
    sendError(res, 404, "NOT_FOUND", "Cuenta no encontrada.")
    return
  }
  await jsonAccountAutopost(res, accountId)
}

export async function patchAccountAutopost(req: Request, res: Response) {
  const accountId = routeAccountId(req.params.id)
  if (!accountId) {
    sendError(res, 404, "NOT_FOUND", "Cuenta no encontrada.")
    return
  }
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
  const account = await prisma.account.findUnique({ where: { id: accountId } })
  if (!account) {
    sendError(res, 404, "NOT_FOUND", "Cuenta no encontrada.")
    return
  }
  await prisma.account.update({
    where: { id: account.id },
    data: { autopostIntervalMs: autopostIntervalToMs(body.value, body.unit) },
  })
  if (account.isDefault) await rescheduleAutopostLoop()
  else if (account.autopostEnabled) await scheduleAccountAutopost(account.id)
  await jsonAccountAutopost(res, account.id)
}

export async function startAccountAutopost(req: Request, res: Response) {
  const accountId = routeAccountId(req.params.id)
  if (!accountId) {
    sendError(res, 404, "NOT_FOUND", "Cuenta no encontrada.")
    return
  }
  if (peekWallapopSession(accountId).status !== "ACTIVE") {
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
  const account = await prisma.account.findUnique({ where: { id: accountId } })
  if (!account) {
    sendError(res, 404, "NOT_FOUND", "Cuenta no encontrada.")
    return
  }
  await prisma.account.update({
    where: { id: account.id },
    data: { autopostEnabled: true },
  })
  if (account.isDefault) {
    try {
      await linkQueuedListingsAlreadyLive(prisma)
    } catch (error) {
      log("warn", "wallapop_already_live_sweep_failed", serializeError(error))
    }
    await rescheduleAutopostLoop()
  } else {
    await scheduleAccountAutopost(account.id)
  }
  await jsonAccountAutopost(res, account.id)
}

export async function stopAccountAutopost(req: Request, res: Response) {
  const accountId = routeAccountId(req.params.id)
  if (!accountId) {
    sendError(res, 404, "NOT_FOUND", "Cuenta no encontrada.")
    return
  }
  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "Database is not configured.")
    return
  }
  const account = await prisma.account.findUnique({ where: { id: accountId } })
  if (!account) {
    sendError(res, 404, "NOT_FOUND", "Cuenta no encontrada.")
    return
  }
  await prisma.account.update({
    where: { id: account.id },
    data: { autopostEnabled: false },
  })
  if (account.isDefault) {
    await abortInFlightPublish()
    pauseAutopostSchedule()
  } else {
    await abortInFlightPublish(await chromePortForAccount(account.id))
    pauseAccountAutopost(account.id)
  }
  await jsonAccountAutopost(res, account.id)
}
