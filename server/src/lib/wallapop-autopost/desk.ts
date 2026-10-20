export type AccountAutopostDesk = {
  generation: number
  timer: ReturnType<typeof setTimeout> | null
  nextAt: number | null
  running: boolean
}

const accountAutopost = new Map<string, AccountAutopostDesk>()

let started = false
let scheduling = false
let scheduleTimer: ReturnType<typeof setTimeout> | null = null
let scheduleGeneration = 0
/** Wall clock when the in-process timer will run `runAutopostTick` (not publish finish). */
let nextAutopostTickAtMs: number | null = null
/** True from the moment a tick starts until it finishes, including the Chrome upload. */
let autopostTickRunning = false

export function extraDesk(accountId: string): AccountAutopostDesk {
  let row = accountAutopost.get(accountId)
  if (!row) {
    row = { generation: 0, timer: null, nextAt: null, running: false }
    accountAutopost.set(accountId, row)
  }
  return row
}

export function peekAccountDesk(
  accountId: string,
): AccountAutopostDesk | undefined {
  return accountAutopost.get(accountId)
}

export function accountNextTickAt(accountId: string): string | null {
  const nextAt = extraDesk(accountId).nextAt
  if (nextAt == null) return null
  return new Date(nextAt).toISOString()
}

/** ISO timestamp of the next scheduled queue tick, or null if the loop is not scheduling. */
export function getNextAutopostTickAt(): string | null {
  if (nextAutopostTickAtMs == null) return null
  return new Date(nextAutopostTickAtMs).toISOString()
}

export function isAutopostTickRunning(): boolean {
  return autopostTickRunning
}

export function setAutopostTickRunning(running: boolean): void {
  autopostTickRunning = running
}

export function isAutopostLoopStarted(): boolean {
  return started
}

export function markAutopostLoopStarted(): void {
  started = true
  scheduling = true
}

/** True only when timers are scheduled. */
export function isWallapopAutopostLoopScheduling(): boolean {
  return scheduling
}

export function bumpScheduleGeneration(): number {
  scheduleGeneration += 1
  return scheduleGeneration
}

export function scheduleGenerationNow(): number {
  return scheduleGeneration
}

export function clearScheduledTick(): void {
  if (scheduleTimer != null) {
    clearTimeout(scheduleTimer)
    scheduleTimer = null
  }
  nextAutopostTickAtMs = null
}

/** Tests only — drop in-process loop flags and the pending timeout. */
export function resetAutopostLoopFlags(): void {
  bumpScheduleGeneration()
  clearScheduledTick()
  autopostTickRunning = false
  started = false
  scheduling = false
}

export function armScheduleTimer(delayMs: number, fire: () => void): void {
  nextAutopostTickAtMs = Date.now() + delayMs
  scheduleTimer = setTimeout(fire, delayMs)
}

/** True when this generation still owns the timer. Clears the armed timeout slot. */
export function releaseScheduleTimer(generation: number): boolean {
  if (generation !== scheduleGeneration) return false
  scheduleTimer = null
  nextAutopostTickAtMs = null
  return true
}
