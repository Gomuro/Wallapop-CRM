import type { PrismaClient } from "../../../generated/prisma/client"
import { getPrisma } from "../db"
import { log, serializeError } from "../log"
import { planDefaultLiveCatalog, writeLiveMark } from "../wallapop-already-live"
import { isWallapopOffline } from "../wallapop-offline"
import { planLiveSync, type LiveSyncAmbiguous, type LiveSyncLink } from "./plan"

export { planLiveSync } from "./plan"
export type { LiveSyncPlan } from "./plan"

/**
 * Monitoring, not publishing: every few minutes the default account's public profile
 * (api.wallapop.com, no Chrome) is compared with the CRM, and queued rows that are
 * already on Wallapop get their link and En Wallapop. Runs whether autopost is on or off.
 */
const TICK_MS = 12 * 60_000
const FIRST_RUN_MS = 15_000

export type LiveSyncMode = "off" | "preview" | "write"

/** WALLAPOP_LIVE_SYNC=write|off; anything else, including unset, only reports. */
export function liveSyncMode(): LiveSyncMode {
  const raw = process.env.WALLAPOP_LIVE_SYNC?.trim().toLowerCase()
  if (raw === "write" || raw === "off") return raw
  return "preview"
}

function linkView({ row, mark }: LiveSyncLink) {
  return {
    sku: row.sku,
    title: row.title,
    price: row.price,
    from: row.listingStatus,
    to: mark.status,
    externalUrl: mark.externalUrl,
    match: mark.reason,
  }
}

function ambiguousView({ row, why }: LiveSyncAmbiguous) {
  return { sku: row.sku, title: row.title, price: row.price, status: row.listingStatus, why }
}

export type LiveSyncResult = { planned: number; linked: number; ambiguous: number }

/** One pass. Preview logs the table of what it would link and writes nothing. */
export async function runLiveSync(
  prisma: PrismaClient,
  mode: Exclude<LiveSyncMode, "off">,
): Promise<LiveSyncResult | null> {
  if (isWallapopOffline()) return null
  const catalog = await planDefaultLiveCatalog(prisma)
  if (!catalog) return null
  const plan = planLiveSync(catalog)
  for (const entry of plan.ambiguous) log("warn", "wallapop_live_sync_ambiguous", ambiguousView(entry))
  let linked = 0
  for (const entry of plan.link) {
    if (mode === "preview") {
      log("info", "wallapop_live_sync_would_link", linkView(entry))
      continue
    }
    if (!(await writeLiveMark(prisma, entry.row, entry.mark))) continue
    linked += 1
    log("info", "wallapop_already_live", { ...linkView(entry), source: "live_sync" })
  }
  const result = { planned: plan.link.length, linked, ambiguous: plan.ambiguous.length }
  log("info", "wallapop_live_sync", { mode, ...result })
  return result
}

const loop = { started: false, running: false, timer: null as NodeJS.Timeout | null }

async function tick(mode: Exclude<LiveSyncMode, "off">): Promise<void> {
  const prisma = getPrisma()
  if (!prisma || loop.running) return
  loop.running = true
  try {
    await runLiveSync(prisma, mode)
  } catch (error) {
    log("error", "wallapop_live_sync_failed", serializeError(error))
  } finally {
    loop.running = false
  }
}

function scheduleNext(mode: Exclude<LiveSyncMode, "off">, delayMs: number): void {
  loop.timer = setTimeout(() => {
    void tick(mode).finally(() => scheduleNext(mode, TICK_MS))
  }, delayMs)
}

/** Right after boot, then every 12 minutes. Never while offline. */
export function startWallapopLiveSyncLoop(): void {
  const mode = liveSyncMode()
  if (loop.started || mode === "off" || isWallapopOffline()) return
  loop.started = true
  log("info", "wallapop_live_sync_started", { mode, tickMs: TICK_MS })
  scheduleNext(mode, FIRST_RUN_MS)
}
