import { afterEach, describe, expect, it } from "vitest"

import {
  isBrowserBusyError,
  resetWallapopPublishAbortForTests,
  runWithBrowserBusy,
  waitForSessionSlotToClear,
} from "../src/lib/wallapop-cdp"
import {
  markSessionProbed,
  resetSessionProbeBackoffForTests,
  SESSION_PROBE_BACKOFF_MS,
  shouldProbeSession,
} from "../src/lib/wallapop-session/probe-backoff"

afterEach(() => {
  resetWallapopPublishAbortForTests()
  resetSessionProbeBackoffForTests()
})

describe("session probe backoff", () => {
  it("probes a DISCONNECTED account once, then waits out the backoff", () => {
    const t0 = 1_000_000
    expect(shouldProbeSession("a", "DISCONNECTED", t0)).toBe(true)
    markSessionProbed("a", t0)
    expect(shouldProbeSession("a", "DISCONNECTED", t0 + 60_000)).toBe(false)
    expect(
      shouldProbeSession("a", "DISCONNECTED", t0 + SESSION_PROBE_BACKOFF_MS),
    ).toBe(true)
  })

  it("never probes while login is running", () => {
    expect(shouldProbeSession("a", "AUTHENTICATING")).toBe(false)
  })

  it("keeps the backoff per account", () => {
    markSessionProbed("a", 1_000)
    expect(shouldProbeSession("b", "DISCONNECTED", 2_000)).toBe(true)
  })
})

describe("login waits for the session probe", () => {
  it("returns once the session slot frees up", async () => {
    const probe = runWithBrowserBusy("session", async () => {
      await new Promise((resolve) => setTimeout(resolve, 150))
    })
    await waitForSessionSlotToClear(undefined, 2_000, 20)
    await expect(runWithBrowserBusy("login", async () => "ok")).resolves.toBe(
      "ok",
    )
    await probe
  })

  it("still fails with BROWSER_BUSY when something else holds Chrome", async () => {
    const publish = runWithBrowserBusy("publish", async () => {
      await new Promise((resolve) => setTimeout(resolve, 100))
    })
    await waitForSessionSlotToClear(undefined, 500, 20)
    await expect(
      runWithBrowserBusy("login", async () => "ok"),
    ).rejects.toSatisfy(isBrowserBusyError)
    await publish
  })
})
