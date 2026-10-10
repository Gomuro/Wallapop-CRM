import { log, serializeError } from "../log"
import { getWallapopSession, rehydrateWallapopSessionOnBoot } from "../wallapop-session"
import { runWallapopMonitorTick } from "./tick"

export const MONITOR_INTERVAL_MS = 5 * 60 * 1000

let started = false
let scheduleTimer: ReturnType<typeof setTimeout> | null = null
let scheduleGeneration = 0

export function resetWallapopMonitorLoopForTests(): void {
  scheduleGeneration += 1
  if (scheduleTimer != null) {
    clearTimeout(scheduleTimer)
    scheduleTimer = null
  }
  started = false
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
  if (generation !== scheduleGeneration) return
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
 * Session-valid, first monitor tick, then every 5 minutes.
 * Idempotent. Chrome quits after the tick if no other worker slot is busy.
 */
export function startWallapopMonitorLoop(): void {
  if (started) {
    log("info", "wallapop_monitor_already_started")
    return
  }
  started = true
  const generation = scheduleGeneration
  log("info", "wallapop_monitor_loop_started", {
    intervalMs: MONITOR_INTERVAL_MS,
  })
  void ensureSessionThenMonitor()
    .catch((error) =>
      log("warn", "wallapop_monitor_boot_failed", {
        err: serializeError(error),
      }),
    )
    .finally(() => {
      scheduleNext(generation)
    })
}
