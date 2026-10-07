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
