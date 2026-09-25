import type { CookieOptions, Request } from "express"
import jwt from "jsonwebtoken"

export const SESSION_COOKIE = "crm_session"
const TOKEN_TTL_SEC = 60 * 60 * 24 * 7

export type SessionPayload = {
  sub: string
  email: string
}

function jwtSecret() {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error("JWT_SECRET is not set")
  }
  return secret
}

export function cookieOptions(): CookieOptions {
  const isProd = process.env.NODE_ENV === "production"
  const sameSite =
    process.env.COOKIE_SAMESITE === "lax"
      ? "lax"
      : process.env.COOKIE_SAMESITE === "strict"
        ? "strict"
        : "none"
  const secure =
    process.env.COOKIE_SECURE === "true" ||
    (process.env.COOKIE_SECURE !== "false" && (isProd || sameSite === "none"))
  return {
    httpOnly: true,
    path: "/",
    maxAge: TOKEN_TTL_SEC * 1000,
    sameSite,
    secure,
  }
}

export function readSessionToken(req: Request) {
  const fromCookie = req.cookies?.[SESSION_COOKIE]
  if (typeof fromCookie === "string" && fromCookie.length > 0) return fromCookie
  return null
}

export function signSessionToken(payload: SessionPayload) {
  return jwt.sign(payload, jwtSecret(), { expiresIn: TOKEN_TTL_SEC })
}

export function verifySessionToken(token: string): SessionPayload {
  const payload = jwt.verify(token, jwtSecret()) as SessionPayload
  if (!payload.sub || !payload.email) {
    throw new Error("Invalid session payload")
  }
  return payload
}
