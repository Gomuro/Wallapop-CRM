import { log } from "../log"
import { closeWallapopUploadTab } from "./tabs"

export type BrowserWorkerSlot = "publish" | "sold" | "monitor" | "session"
export type BrowserExclusiveOp = "login" | "logout"
export type BrowserBusy = "idle" | BrowserWorkerSlot | BrowserExclusiveOp

const WORKER_SLOT_ORDER = [
  "publish",
  "sold",
  "monitor",
  "session",
] as const satisfies readonly BrowserWorkerSlot[]

const workerSlots = new Set<BrowserWorkerSlot>()
let exclusiveBusy: BrowserExclusiveOp | null = null
/** AbortController for the in-flight publish tick; null when not publishing. */
let publishAbort: AbortController | null = null
/** Set by Stop: skip quitWallapopChrome so the session stays warm for next Start. */
let keepChromeAfterAbort = false
/** Monitor loop: keep chrome.exe between ticks (slot is idle for 5 min). */
let keepChromeWarm = false

export class BrowserBusyError extends Error {
  readonly code = "BROWSER_BUSY" as const
  readonly busyWith: BrowserBusy
  constructor(busyWith: BrowserBusy, attempted: BrowserBusy) {
    super(
      `Chrome ocupado con «${busyWith}»; no se puede iniciar «${attempted}». Espera a que termine.`,
    )
    this.name = "BrowserBusyError"
    this.busyWith = busyWith
  }
}

export function isBrowserBusyError(error: unknown): error is BrowserBusyError {
  return error instanceof BrowserBusyError
}

export class PublishAbortedError extends Error {
  readonly code = "PUBLISH_ABORTED" as const
  constructor() {
    super("Publicación abortada (autopost detenido).")
    this.name = "PublishAbortedError"
  }
}

export function isPublishAbortedError(
  error: unknown,
): error is PublishAbortedError {
  return error instanceof PublishAbortedError
}

export function isInFlightPublishAborted(): boolean {
  return publishAbort?.signal.aborted === true
}

export function throwIfPublishAborted(): void {
  if (isInFlightPublishAborted()) throw new PublishAbortedError()
}

function isWorkerSlot(op: Exclude<BrowserBusy, "idle">): op is BrowserWorkerSlot {
  return (WORKER_SLOT_ORDER as readonly string[]).includes(op)
}

function firstBusyWorkerSlot(): BrowserWorkerSlot | null {
  return WORKER_SLOT_ORDER.find((slot) => workerSlots.has(slot)) ?? null
}

/**
 * Prefer publish when worker slots overlap so the posting
 * watchdog still treats an in-flight Publicar as holding Chrome.
 */
export function getBrowserBusy(): BrowserBusy {
  if (exclusiveBusy) return exclusiveBusy
  return firstBusyWorkerSlot() ?? "idle"
}

export function isBrowserPublishBusy(): boolean {
  return workerSlots.has("publish")
}

export function isBrowserSoldBusy(): boolean {
  return workerSlots.has("sold")
}

export function isBrowserMonitorBusy(): boolean {
  return workerSlots.has("monitor")
}

export function isBrowserSessionBusy(): boolean {
  return workerSlots.has("session")
}

export function isAnyWorkerSlotBusy(): boolean {
  return workerSlots.size > 0
}

export function setKeepChromeWarm(on: boolean): void {
  keepChromeWarm = on
}

export function isKeepChromeWarm(): boolean {
  return keepChromeWarm
}

function occupantForExclusive(): BrowserBusy {
  if (exclusiveBusy) return exclusiveBusy
  return firstBusyWorkerSlot() ?? "idle"
}

function assertCanStart(op: Exclude<BrowserBusy, "idle">): void {
  if (isWorkerSlot(op)) {
    if (exclusiveBusy) throw new BrowserBusyError(exclusiveBusy, op)
    if (workerSlots.has(op)) throw new BrowserBusyError(op, op)
    return
  }
  const occupant = occupantForExclusive()
  if (occupant !== "idle") throw new BrowserBusyError(occupant, op)
}

/**
 * Stop the current publish tick: abort CDP waits and close the owned upload tab.
 * Does not quit chrome.exe — the `/wall` session stays for the next Start.
 */
export async function abortInFlightPublish(): Promise<void> {
  if (!workerSlots.has("publish")) {
    log("info", "wallapop_publish_abort_idle", { busy: getBrowserBusy() })
    return
  }
  keepChromeAfterAbort = true
  publishAbort?.abort()
  log("info", "wallapop_publish_abort_requested")
  await closeWallapopUploadTab()
}

export function consumeKeepChromeAfterAbort(): boolean {
  const keep = keepChromeAfterAbort
  keepChromeAfterAbort = false
  return keep
}

/** Tests only — drop abort / busy flags. Does not touch the CDP handle. */
export function resetWallapopPublishAbortForTests(): void {
  publishAbort = null
  keepChromeAfterAbort = false
  keepChromeWarm = false
  exclusiveBusy = null
  workerSlots.clear()
}

/**
 * Reject if this op cannot start. Worker slots may overlap;
 * login/logout stay exclusive against everything.
 */
export function assertBrowserIdle(forOp: Exclude<BrowserBusy, "idle">): void {
  assertCanStart(forOp)
}

function occupy(op: Exclude<BrowserBusy, "idle">): void {
  if (op === "publish") {
    publishAbort = new AbortController()
    workerSlots.add("publish")
    return
  }
  if (isWorkerSlot(op)) {
    workerSlots.add(op)
    return
  }
  exclusiveBusy = op
}

function release(op: Exclude<BrowserBusy, "idle">): void {
  if (op === "publish") {
    publishAbort = null
    workerSlots.delete("publish")
    return
  }
  if (isWorkerSlot(op)) {
    workerSlots.delete(op)
    return
  }
  exclusiveBusy = null
}

export async function runWithBrowserBusy<T>(
  op: Exclude<BrowserBusy, "idle">,
  fn: () => Promise<T>,
): Promise<T> {
  assertCanStart(op)
  occupy(op)
  try {
    return await fn()
  } finally {
    release(op)
  }
}
