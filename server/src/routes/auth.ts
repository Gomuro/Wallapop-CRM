import bcrypt from "bcryptjs"
import type { Request, Response } from "express"
import { ZodError } from "zod"

import { userLoginSchema } from "../../../lib/validations/user"
import { getPrisma } from "../lib/db"
import { sendError } from "../lib/http-error"
import {
  SESSION_COOKIE,
  cookieOptions,
  signSessionToken,
} from "../lib/session"

function publicUser(user: { id: string; email: string; name: string }) {
  return { id: user.id, email: user.email, name: user.name }
}

export async function login(req: Request, res: Response) {
  let body: { email: string; password: string }
  try {
    body = userLoginSchema.parse(req.body)
  } catch (error) {
    if (error instanceof ZodError) {
      sendError(res, 400, "VALIDATION_ERROR", error.issues[0]?.message ?? "Invalid body.")
      return
    }
    throw error
  }

  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "Database is not configured.")
    return
  }

  const user = await prisma.user.findUnique({
    where: { email: body.email.toLowerCase() },
  })
  if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
    sendError(res, 401, "UNAUTHORIZED", "Invalid email or password.")
    return
  }

  const token = signSessionToken(
    { sub: user.id, email: user.email },
  )
  res.cookie(SESSION_COOKIE, token, cookieOptions())
  res.json({ user: publicUser(user) })
}

export function logout(_req: Request, res: Response) {
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(), maxAge: 0 })
  res.json({ ok: true })
}

export async function me(req: Request, res: Response) {
  const prisma = getPrisma()
  if (!prisma || !req.user) {
    sendError(res, 401, "UNAUTHORIZED", "Sign in required.")
    return
  }
  const user = await prisma.user.findUnique({ where: { id: req.user.id } })
  if (!user) {
    sendError(res, 401, "UNAUTHORIZED", "Sign in required.")
    return
  }
  res.json({ user: publicUser(user) })
}
