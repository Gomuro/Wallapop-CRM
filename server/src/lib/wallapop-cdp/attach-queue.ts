import { promiseWithin } from "./busy"

/** Longer than a slow quit + spawn + connect. A stuck attach must not block the port. */
export const ATTACH_LIMIT_MS = 120_000

const attachTails = new Map<number, Promise<unknown>>()

/**
 * One attach per port. VPS 2026-11-04 18:31Z: publish and monitor attached together,
 * the relaunch of one killed the other's Chrome and publish held its slot for hours.
 * The time limit keeps the queue moving when an attach never returns.
 */
export function oneAttachAtATime<T>(
  port: number,
  attach: () => Promise<T>,
  limitMs = ATTACH_LIMIT_MS,
): Promise<T> {
  const previous = attachTails.get(port) ?? Promise.resolve()
  const run = previous
    .catch(() => {})
    .then(() => promiseWithin(attach(), limitMs, "CDP attach"))
  attachTails.set(port, run)
  void run
    .catch(() => {})
    .finally(() => {
      if (attachTails.get(port) === run) attachTails.delete(port)
    })
  return run
}
