export const SESSION_COOKIE = "crm_session"

/** Browser stays on Vercel HTTPS; Next rewrites `/api/v1` and `/uploads` to the VPS. */
export function isApiProxy(): boolean {
  const flag = process.env.NEXT_PUBLIC_API_PROXY?.trim().toLowerCase()
  return flag === "1" || flag === "true"
}

export function getPublicApiUrl(): string {
  if (isApiProxy()) return ""
  const fromEnv = process.env.NEXT_PUBLIC_API_URL?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, "")
  if (process.env.NODE_ENV === "development") return "http://localhost:4000"
  return ""
}

/** Production/preview: explicit API origin, or same-origin proxy via NEXT_PUBLIC_API_PROXY. */
export function isApiConfigured(): boolean {
  return isApiProxy() || Boolean(process.env.NEXT_PUBLIC_API_URL?.trim())
}

export function apiV1Path(path: string): string {
  const base = getPublicApiUrl()
  const segment = path.startsWith("/") ? path : `/${path}`
  return `${base}/api/v1${segment}`
}

/** Absolute URL for `/uploads/…` paths served by Express. */
export function resolveMediaUrl(url: string | null | undefined): string {
  if (!url) return ""
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("blob:")) {
    return url
  }
  if (url.startsWith("/uploads/")) {
    const base = getPublicApiUrl()
    return base ? `${base}${url}` : url
  }
  return url
}
