import "../load-env"

export function requireLocalDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) {
    throw new Error("DATABASE_URL is missing in server/.env (local Docker Postgres).")
  }
  return url
}

export function requireVpsDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_VPS?.trim()
  if (!url) {
    throw new Error(
      "DATABASE_URL_VPS is missing in server/.env. Open an SSH tunnel to VPS Postgres, then point this URL at the local tunnel port.",
    )
  }
  return url
}

export function sshTarget(): string | null {
  return process.env.OPS_SSH?.trim() || null
}

export function tunnelPort(): number {
  const raw = Number(process.env.OPS_TUNNEL_PORT ?? 5437)
  return Number.isFinite(raw) && raw > 0 ? raw : 5437
}

function sshHost(): string | null {
  const target = sshTarget()
  if (!target) return null
  const at = target.lastIndexOf("@")
  return at >= 0 ? target.slice(at + 1) : target
}

/** HTTP origin of the VPS Express process (static /uploads and API). */
export function opsUploadOrigin(): string {
  const fromEnv = process.env.OPS_UPLOAD_ORIGIN?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, "")
  const host = sshHost()
  if (!host) {
    throw new Error("OPS_UPLOAD_ORIGIN or OPS_SSH is required to sync photos.")
  }
  const port = process.env.OPS_UPLOAD_PORT?.trim() || process.env.PORT || "4000"
  return `http://${host}:${port}`
}
