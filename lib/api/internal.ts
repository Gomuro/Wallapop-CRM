import "server-only"

import { getPublicApiUrl } from "@/lib/api/config"

/** Express origin for server-side fetch (Vercel rewrite / VPS). Not exposed to the browser. */
export function getInternalApiUrl(): string {
  const upstream = process.env.API_UPSTREAM?.trim().replace(/\/$/, "")
  if (upstream) return upstream
  return getPublicApiUrl()
}

export function internalApiV1Path(path: string): string {
  const base = getInternalApiUrl()
  const segment = path.startsWith("/") ? path : `/${path}`
  return `${base}/api/v1${segment}`
}
