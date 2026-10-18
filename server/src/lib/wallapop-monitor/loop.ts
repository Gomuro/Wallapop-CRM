import { log, serializeError } from "../log"
import {
  getWallapopSession,
  rehydrateSavedAccountSessions,
  rehydrateWallapopSessionOnBoot,
} from "../wallapop-session"
import { readDevMonitorEnabled } from "./dev-switch"
import { runWallapopMonitorTick } from "./tick"

export const MONITOR_INTERVAL_MS = 5 * 60 * 1000

let started = false
let enabled = true
let scheduleTimer: ReturnType<typeof setTimeout> | null = null
let scheduleGeneration = 0

export function resetWallapopMonitorLoopForTests(): void {
  scheduleGeneration += 1
  if (scheduleTimer != null) {
    clearTimeout(scheduleTimer)
    scheduleTimer = null
  }
  started = false
  enabled = true
}

export function isWallapopMonitorEnabled(): boolean {
  return enabled
}

/** Stops the Chrome probe. Turning it back on runs one pass now. */
export function setWallapopMonitorEnabled(next: boolean): boolean {
  enabled = next
  if (!started) return enabled
  scheduleGeneration += 1
  if (scheduleTimer != null) {
    clearTimeout(scheduleTimer)
    scheduleTimer = null
  }
  if (!enabled) {
    log("info", "wallapop_monitor_paused")
    return enabled
  }
  log("info", "wallapop_monitor_resumed")
  void runScheduledTick(scheduleGeneration)
  return enabled
}

function scheduleNext(generation: number): void {
  if (generation !== scheduleGeneration) return
  scheduleTimer = setTimeout(() => {
    void runScheduledTick(generation)
  }, MONITOR_INTERVAL_MS)
}

async function ensureSessionThenMonitor(): Promise<void> {
  let session = getWallapopSession()
  if (session.status !== "ACTIVE") {
    session = await rehydrateWallapopSessionOnBoot()
    log("info", "wallapop_session_rehydrate", {
      status: session.status,
      requires2FA: session.requires2FA,
    })
  }
  if (session.status !== "ACTIVE") {
    log("info", "wallapop_monitor_skip_session", { status: session.status })
    return
  }
  await runWallapopMonitorTick()
}

async function runScheduledTick(generation: number): Promise<void> {
  if (generation !== scheduleGeneration || !enabled) return
  try {
    await ensureSessionThenMonitor()
  } catch (error) {
    log("warn", "wallapop_monitor_loop_tick_failed", {
      err: serializeError(error),
    })
  }
  scheduleNext(generation)
}

/**
 * Session probe on boot, then En venta/Vendidos immediately and every 5 minutes.
 */
export function startWallapopMonitorLoop(): void {
  if (started) {
    log("info", "wallapop_monitor_already_started")
    return
  }
  started = true
  enabled = readDevMonitorEnabled()
  const generation = scheduleGeneration
  log("info", "wallapop_monitor_loop_started", {
    intervalMs: MONITOR_INTERVAL_MS,
    enabled,
  })
  if (!enabled) {
    log("info", "wallapop_monitor_paused")
    void rehydrateSavedAccountSessions().catch((error) =>
      log("warn", "wallapop_monitor_boot_failed", {
        err: serializeError(error),
      }),
    )
    return
  }
  void (async () => {
    await rehydrateSavedAccountSessions()
    const session = getWallapopSession()
    if (session.status === "ACTIVE") return
    const again = await rehydrateWallapopSessionOnBoot()
    log("info", "wallapop_session_rehydrate", {
      status: again.status,
      requires2FA: again.requires2FA,
    })
  })()
    .catch((error) =>
      log("warn", "wallapop_monitor_boot_failed", {
        err: serializeError(error),
      }),
    )
    .finally(() => {
      void runScheduledTick(generation)
    })
}
