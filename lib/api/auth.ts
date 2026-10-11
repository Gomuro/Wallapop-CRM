import { apiClientFetch, apiFetch } from "@/lib/api/client"
import { ApiError } from "@/lib/api/errors"

export type AuthUser = {
  id: string
  email: string
  name: string
}

type MeResponse = { user: AuthUser }
type LoginResponse = { user: AuthUser }

const KNOWN_EMAIL_HOST =
  /^(gmail\.com|googlemail\.com|icloud\.com|me\.com|outlook\.com|hotmail\.com|yahoo\.es|yahoo\.com)$/i

/** iOS / Telegram often drop `@` (`flshop935gmail.com`). Put it back for known hosts. */
export function normalizeLoginEmail(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed || trimmed.includes("@")) return trimmed
  const match = trimmed.match(
    /^(.+?)(gmail\.com|googlemail\.com|icloud\.com|me\.com|outlook\.com|hotmail\.com|yahoo\.es|yahoo\.com)$/i,
  )
  if (!match) return trimmed
  const local = match[1]
  const host = match[2]
  if (!local || KNOWN_EMAIL_HOST.test(local)) return trimmed
  return `${local}@${host}`
}

export function isPlausibleLoginEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export async function login(email: string, password: string) {
  const data = await apiClientFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  })
  return data.user
}

export async function logout() {
  await apiClientFetch<{ ok: boolean }>("/auth/logout", { method: "POST" })
}

export async function getMe(cookieHeader?: string) {
  if (cookieHeader) {
    const { data } = await apiFetch<MeResponse>("/auth/me", { cookieHeader })
    return data.user
  }
  const data = await apiClientFetch<MeResponse>("/auth/me")
  return data.user
}

export function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "API_NOT_CONFIGURED") {
      return "La API no está configurada. Contacta con el administrador."
    }
    if (error.code === "NETWORK") return error.message
    if (error.status === 401) return "Email o contraseña incorrectos."
    if (error.status === 404) {
      return "El servidor no está disponible o la dirección de la API no es correcta."
    }
    return error.message
  }
  return "No se ha podido iniciar sesión. Inténtalo de nuevo."
}
