export const SESSION_COOKIE = "crm_session"

export function getPublicApiUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_URL?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, "")
  if (process.env.NODE_ENV === "development") return "http://localhost:4000"
  return ""
}

/** Production/preview builds need an explicit API origin (Express on VPS). */
export function isApiConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_API_URL?.trim())
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
    return `${getPublicApiUrl()}${url}`
  }
  return url
}
