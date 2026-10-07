import { log } from "../log"
import { closeWallapopUploadTab } from "./tabs"

export type BrowserBusy = "idle" | "publish" | "login" | "logout" | "rehydrate"

let browserBusy: BrowserBusy = "idle"
/** AbortController for the in-flight publish tick; null when not publishing. */
let publishAbort: AbortController | null = null
/** Set by Stop: skip quitWallapopChrome so the session stays warm for next Start. */
let keepChromeAfterAbort = false

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

/**
 * Stop the current publish tick: abort CDP waits and close the owned upload tab.
 * Does not quit chrome.exe — the `/wall` session stays for the next Start.
 */
export async function abortInFlightPublish(): Promise<void> {
  if (browserBusy !== "publish") {
    log("info", "wallapop_publish_abort_idle", { busy: browserBusy })
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
  browserBusy = "idle"
}

export function getBrowserBusy(): BrowserBusy {
  return browserBusy
}

/** True when a publish run holds the Chrome lock. */
export function isBrowserPublishBusy(): boolean {
  return browserBusy === "publish"
}

/**
 * Reject if any op holds the lock (single-owner; no same-op re-entry).
 * Nested closeWallapopBrowser during login/logout is allowed separately.
 */
export function assertBrowserIdle(forOp: Exclude<BrowserBusy, "idle">): void {
  if (browserBusy === "idle") return
  throw new BrowserBusyError(browserBusy, forOp)
}

export async function runWithBrowserBusy<T>(
  op: Exclude<BrowserBusy, "idle">,
  fn: () => Promise<T>,
): Promise<T> {
  assertBrowserIdle(op)
  if (op === "publish") publishAbort = new AbortController()
  browserBusy = op
  try {
    return await fn()
  } finally {
    if (op === "publish") publishAbort = null
    browserBusy = "idle"
  }
}
