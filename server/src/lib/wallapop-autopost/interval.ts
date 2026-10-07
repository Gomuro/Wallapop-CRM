import type { PrismaClient } from "../../../generated/prisma/client"

import {
  AUTOPOST_INTERVAL_MS_MAX,
  AUTOPOST_INTERVAL_MS_MIN,
} from "../../../../lib/validations/account"
import { getRecentAutopostSkips } from "../autopost-recent-skips"
import { getPrisma } from "../db"

/** Default ~15 min. Override with account UI, else `WALLAPOP_AUTOPOST_INTERVAL_MS`. */
export const DEFAULT_AUTOPOST_INTERVAL_MS = 15 * 60 * 1000

export { AUTOPOST_INTERVAL_MS_MAX, AUTOPOST_INTERVAL_MS_MIN }

export const AUTOPOST_JITTER_FRACTION = 0.2

export type AutopostIntervalSource = "account" | "env" | "default"

export type AutopostIntervalResolution = {
  effectiveIntervalMs: number
  source: AutopostIntervalSource
  storedIntervalMs: number | null
}

/** Exact string `true` — unset / `1` / `TRUE` stay off. */
export function isWallapopAutopostEnabled(): boolean {
  return process.env.WALLAPOP_AUTOPOST === "true"
}

/**
 * Live Publicar only when env is exactly `false`.
 * Unset / `true` keep the queue idle (no Chrome). Same rule as publish env.
 */
export function isAutopostLivePublishEnabled(): boolean {
  return process.env.WALLAPOP_PUBLISH_DRY_RUN === "false"
}

/** Env-only interval, or null when unset / invalid (caller falls back to default). */
export function readAutopostIntervalMsFromEnv(): number | null {
  const raw = process.env.WALLAPOP_AUTOPOST_INTERVAL_MS
  if (raw == null || raw.trim() === "") return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

/** Env or 15 min. Does not read the account column — use `resolveAutopostIntervalMs`. */
export function readAutopostIntervalMs(): number {
  return readAutopostIntervalMsFromEnv() ?? DEFAULT_AUTOPOST_INTERVAL_MS
}

function isPositiveIntervalMs(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value > 0
}

export async function resolveAutopostInterval(
  prisma?: PrismaClient | null,
): Promise<AutopostIntervalResolution> {
  const client = prisma === undefined ? getPrisma() : prisma
  let storedIntervalMs: number | null = null
  if (client) {
    const account = await client.account.findFirst({
      where: { isDefault: true },
      select: { autopostIntervalMs: true },
    })
    if (isPositiveIntervalMs(account?.autopostIntervalMs)) {
      storedIntervalMs = account.autopostIntervalMs
    }
  }

  if (storedIntervalMs != null) {
    return {
      effectiveIntervalMs: storedIntervalMs,
      source: "account",
      storedIntervalMs,
    }
  }

  const envMs = readAutopostIntervalMsFromEnv()
  if (envMs != null) {
    return {
      effectiveIntervalMs: envMs,
      source: "env",
      storedIntervalMs: null,
    }
  }

  return {
    effectiveIntervalMs: DEFAULT_AUTOPOST_INTERVAL_MS,
    source: "default",
    storedIntervalMs: null,
  }
}

export async function resolveAutopostIntervalMs(
  prisma?: PrismaClient | null,
): Promise<number> {
  const { effectiveIntervalMs } = await resolveAutopostInterval(prisma)
  return effectiveIntervalMs
}

export function toAutopostStatusJson(
  resolution: AutopostIntervalResolution,
  extras: {
    enabled: boolean
    lastPublication: { at: string; title: string } | null
    nextTickAt: string | null
    recentSkips?: ReturnType<typeof getRecentAutopostSkips>
  },
) {
  return {
    effectiveIntervalMs: resolution.effectiveIntervalMs,
    source: resolution.source,
    jitterFraction: AUTOPOST_JITTER_FRACTION,
    enabled: extras.enabled,
    livePublish: isAutopostLivePublishEnabled(),
    lastPublication: extras.lastPublication,
    nextTickAt: extras.nextTickAt,
    recentSkips: extras.recentSkips ?? getRecentAutopostSkips(),
  }
}

/**
 * ±20% around the base interval so ticks are not metronomic.
 * `random` is injectable for tests (0 → −20%, 0.5 → 0%, 1 → +20%).
 */
export function autopostDelayWithJitter(
  intervalMs: number,
  random: () => number = Math.random,
): number {
  const spread = intervalMs * AUTOPOST_JITTER_FRACTION
  return Math.max(0, Math.round(intervalMs + (random() * 2 - 1) * spread))
}
