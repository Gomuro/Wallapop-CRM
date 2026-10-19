import { firstCdpPort } from "../../../../lib/accounts/chrome-place"
import { log } from "../log"
import { closeWallapopUploadTab } from "./tabs"

export type BrowserWorkerSlot =
  | "publish"
  | "sold"
  | "eliminar"
  | "monitor"
  | "session"
export type BrowserExclusiveOp = "login" | "logout"
export type BrowserBusy = "idle" | BrowserWorkerSlot | BrowserExclusiveOp

const WORKER_SLOT_ORDER = [
  "publish",
  "sold",
  "eliminar",
  "monitor",
  "session",
] as const satisfies readonly BrowserWorkerSlot[]

type Desk = {
  workerSlots: Set<BrowserWorkerSlot>
  exclusiveBusy: BrowserExclusiveOp | null
  publishAbort: AbortController | null
  keepChromeAfterAbort: boolean
  keepChromeWarm: boolean
  chromeQuit: Promise<void> | null
}

const desks = new Map<number, Desk>()

function desk(port = firstCdpPort()): Desk {
  let row = desks.get(port)
  if (!row) {
    row = {
      workerSlots: new Set(),
      exclusiveBusy: null,
      publishAbort: null,
      keepChromeAfterAbort: false,
      keepChromeWarm: false,
      chromeQuit: null,
    }
    desks.set(port, row)
  }
  return row
}

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

export function isInFlightPublishAborted(port = firstCdpPort()): boolean {
  return desk(port).publishAbort?.signal.aborted === true
}

export function throwIfPublishAborted(): void {
  if (isInFlightPublishAborted()) throw new PublishAbortedError()
}

function isWorkerSlot(op: Exclude<BrowserBusy, "idle">): op is BrowserWorkerSlot {
  return (WORKER_SLOT_ORDER as readonly string[]).includes(op)
}

function firstBusyWorkerSlot(port = firstCdpPort()): BrowserWorkerSlot | null {
  const slots = desk(port).workerSlots
  return WORKER_SLOT_ORDER.find((slot) => slots.has(slot)) ?? null
}

/**
 * Prefer publish when worker slots overlap so the posting
 * watchdog still treats an in-flight Publicar as holding Chrome.
 */
export function getBrowserBusy(port = firstCdpPort()): BrowserBusy {
  const row = desk(port)
  if (row.exclusiveBusy) return row.exclusiveBusy
  return firstBusyWorkerSlot(port) ?? "idle"
}

export function isBrowserPublishBusy(port = firstCdpPort()): boolean {
  return desk(port).workerSlots.has("publish")
}

export function isBrowserSoldBusy(port = firstCdpPort()): boolean {
  return desk(port).workerSlots.has("sold")
}

export function isBrowserEliminarBusy(port = firstCdpPort()): boolean {
  return desk(port).workerSlots.has("eliminar")
}

export function isBrowserMonitorBusy(port = firstCdpPort()): boolean {
  return desk(port).workerSlots.has("monitor")
}

export function isBrowserSessionBusy(port = firstCdpPort()): boolean {
  return desk(port).workerSlots.has("session")
}

export function isAnyWorkerSlotBusy(port = firstCdpPort()): boolean {
  return desk(port).workerSlots.size > 0
}

export function setKeepChromeWarm(on: boolean, port = firstCdpPort()): void {
  desk(port).keepChromeWarm = on
}

export function isKeepChromeWarm(port = firstCdpPort()): boolean {
  return desk(port).keepChromeWarm
}

export function waitForChromeQuit(port = firstCdpPort()): Promise<void> {
  return desk(port).chromeQuit ?? Promise.resolve()
}

/** Bound a CDP call. A hung Browser.close must not pin the next publish. */
export function promiseWithin<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/** One quit at a time. Caller must have already seen idle worker slots. */
export function beginChromeQuit(
  fn: () => Promise<void>,
  port = firstCdpPort(),
): Promise<void> {
  const row = desk(port)
  if (row.chromeQuit) return row.chromeQuit
  row.chromeQuit = fn().finally(() => {
    row.chromeQuit = null
  })
  return row.chromeQuit
}

function occupantForExclusive(port = firstCdpPort()): BrowserBusy {
  const row = desk(port)
  if (row.exclusiveBusy) return row.exclusiveBusy
  return firstBusyWorkerSlot(port) ?? "idle"
}

function assertCanStart(op: Exclude<BrowserBusy, "idle">, port = firstCdpPort()): void {
  const row = desk(port)
  if (isWorkerSlot(op)) {
    if (row.exclusiveBusy) throw new BrowserBusyError(row.exclusiveBusy, op)
    if (row.workerSlots.has(op)) throw new BrowserBusyError(op, op)
    return
  }
  const occupant = occupantForExclusive(port)
  if (occupant !== "idle") throw new BrowserBusyError(occupant, op)
}

/**
 * Stop the current publish tick: abort CDP waits and close the owned upload tab.
 * Does not quit chrome.exe — the `/wall` session stays for the next Start.
 */
export async function abortInFlightPublish(port = firstCdpPort()): Promise<void> {
  const row = desk(port)
  if (!row.workerSlots.has("publish")) {
    log("info", "wallapop_publish_abort_idle", { busy: getBrowserBusy(port) })
    return
  }
  row.keepChromeAfterAbort = true
  row.publishAbort?.abort()
  log("info", "wallapop_publish_abort_requested")
  await closeWallapopUploadTab(port)
}

export function consumeKeepChromeAfterAbort(port = firstCdpPort()): boolean {
  const row = desk(port)
  const keep = row.keepChromeAfterAbort
  row.keepChromeAfterAbort = false
  return keep
}

/** Tests only — drop abort / busy flags. Does not touch the CDP handle. */
export function resetWallapopPublishAbortForTests(): void {
  desks.clear()
}

/**
 * Reject if this op cannot start. Worker slots may overlap;
 * login/logout stay exclusive against everything on that Chrome.
 */
export function assertBrowserIdle(
  forOp: Exclude<BrowserBusy, "idle">,
  port = firstCdpPort(),
): void {
  assertCanStart(forOp, port)
}

function occupy(op: Exclude<BrowserBusy, "idle">, port = firstCdpPort()): void {
  const row = desk(port)
  if (op === "publish") {
    row.publishAbort = new AbortController()
    row.workerSlots.add("publish")
    return
  }
  if (isWorkerSlot(op)) {
    row.workerSlots.add(op)
    return
  }
  row.exclusiveBusy = op
}

function release(op: Exclude<BrowserBusy, "idle">, port = firstCdpPort()): void {
  const row = desk(port)
  if (op === "publish") {
    row.publishAbort = null
    row.workerSlots.delete("publish")
    return
  }
  if (isWorkerSlot(op)) {
    row.workerSlots.delete(op)
    return
  }
  row.exclusiveBusy = null
}

export async function runWithBrowserBusy<T>(
  op: Exclude<BrowserBusy, "idle">,
  fn: () => Promise<T>,
  port = firstCdpPort(),
): Promise<T> {
  assertCanStart(op, port)
  occupy(op, port)
  try {
    return await fn()
  } finally {
    release(op, port)
  }
}
