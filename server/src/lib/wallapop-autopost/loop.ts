import { log, serializeError } from "../log"
import {
  armScheduleTimer,
  bumpScheduleGeneration,
  clearScheduledTick,
  extraDesk,
  isAutopostLoopStarted,
  isWallapopAutopostLoopScheduling,
  markAutopostLoopStarted,
  peekAccountDesk,
  releaseScheduleTimer,
  resetAutopostLoopFlags,
  scheduleGenerationNow,
  setAutopostTickRunning,
} from "./desk"
import {
  autopostDelayWithJitter,
  DEFAULT_AUTOPOST_INTERVAL_MS,
  isAutopostLivePublishEnabled,
  resolveAutopostInterval,
  resolveAutopostIntervalMs,
} from "./interval"
import { isDefaultAccountAutopostEnabled } from "./status"
import { runAccountAutopostTick, runAutopostTick } from "./tick"
import { getPrisma } from "../db"

export { isWallapopAutopostLoopScheduling }

async function readScheduleIntervalMs(): Promise<number> {
  try {
    return await resolveAutopostIntervalMs()
  } catch (error) {
    log(
      "error",
      "wallapop_autopost_interval_resolve_failed",
      serializeError(error),
    )
    return DEFAULT_AUTOPOST_INTERVAL_MS
  }
}

function fireScheduledTick(generation: number): void {
  if (!releaseScheduleTimer(generation)) return
  setAutopostTickRunning(true)
  void runAutopostTick()
    // Empty queue: keep the normal interval, so nothing has to wake the loop.
    .then(async () => {
      if (generation === scheduleGenerationNow()) await scheduleNextAsync()
    })
    .catch((error) => {
      log("error", "wallapop_autopost_tick_failed", serializeError(error))
    })
    .finally(() => {
      setAutopostTickRunning(false)
    })
}

async function scheduleNextAsync(): Promise<void> {
  const generation = bumpScheduleGeneration()
  clearScheduledTick()
  const intervalMs = await readScheduleIntervalMs()
  if (generation !== scheduleGenerationNow()) return
  const delayMs = autopostDelayWithJitter(intervalMs)
  armScheduleTimer(delayMs, () => {
    fireScheduledTick(generation)
  })
}

/**
 * Fire-and-forget in-process loop. Idempotent if called twice.
 * Always schedules; each tick no-ops unless the default account has
 * `autopostEnabled` and live publish env is on.
 */
export function startWallapopAutopostLoop(): void {
  try {
    if (isAutopostLoopStarted()) {
      log("info", "wallapop_autopost_already_started")
      return
    }

    markAutopostLoopStarted()
    log("info", "wallapop_autopost_started", {
      livePublish: isAutopostLivePublishEnabled(),
    })
    void scheduleNextAsync()
    void scheduleEnabledAccountAutopost()
  } catch (error) {
    log("error", "wallapop_autopost_start_failed", serializeError(error))
  }
}

/**
 * Drop the pending wait and start a new one from the current interval.
 * Used after PATCH interval / Start so the countdown is not leftover from
 * a previous (longer) timeout.
 */
export async function rescheduleAutopostLoop(): Promise<void> {
  if (!isAutopostLoopStarted() || !isWallapopAutopostLoopScheduling()) return
  try {
    if (!(await isDefaultAccountAutopostEnabled())) return
  } catch {
    // Keep scheduling when the enabled probe fails (tests / brief DB blip).
  }
  await scheduleNextAsync()
}

/** Stop the 1-minute queue timer (empty cola or Detener). Start / new READY_TO_POST call reschedule. */
export function pauseAutopostSchedule(): void {
  bumpScheduleGeneration()
  clearScheduledTick()
}

/** Tests only — drop in-process loop flags and pending timeouts. */
export function resetWallapopAutopostLoopForTests(): void {
  resetAutopostLoopFlags()
}

async function scheduleEnabledAccountAutopost(): Promise<void> {
  const prisma = getPrisma()
  if (!prisma) return
  const rows = await prisma.account.findMany({
    where: { isDefault: false, autopostEnabled: true },
    select: { id: true },
  })
  for (const row of rows) {
    await scheduleAccountAutopost(row.id)
  }
}

export function pauseAccountAutopost(accountId: string): void {
  const desk = peekAccountDesk(accountId)
  if (!desk) return
  desk.generation += 1
  if (desk.timer != null) clearTimeout(desk.timer)
  desk.timer = null
  desk.nextAt = null
}

function fireAccountTick(accountId: string, generation: number): void {
  const desk = extraDesk(accountId)
  if (generation !== desk.generation) return
  desk.timer = null
  desk.nextAt = null
  desk.running = true
  void runAccountAutopostTick(accountId)
    .then(async () => {
      if (generation === desk.generation) {
        await scheduleAccountAutopost(accountId)
      }
    })
    .catch((error) => {
      log("error", "wallapop_autopost_tick_failed", serializeError(error))
    })
    .finally(() => {
      desk.running = false
    })
}

export async function scheduleAccountAutopost(accountId: string): Promise<void> {
  const prisma = getPrisma()
  if (!prisma) return
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { isDefault: true, autopostEnabled: true },
  })
  if (!account || account.isDefault) {
    await rescheduleAutopostLoop()
    return
  }
  if (!account.autopostEnabled) return
  const desk = extraDesk(accountId)
  const generation = ++desk.generation
  if (desk.timer != null) clearTimeout(desk.timer)
  const resolution = await resolveAutopostInterval(prisma, accountId)
  const delayMs = autopostDelayWithJitter(resolution.effectiveIntervalMs)
  desk.nextAt = Date.now() + delayMs
  desk.timer = setTimeout(() => {
    fireAccountTick(accountId, generation)
  }, delayMs)
}
