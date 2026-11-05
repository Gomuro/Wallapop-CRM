import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const chrome = vi.hoisted(() => ({
  listening: false,
  spawns: 0,
  kills: 0,
}))

vi.mock("../src/lib/wallapop-cdp/chrome", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/wallapop-cdp/chrome")>()),
  hydrateChromeProxyFromAccount: async () => {},
  chromeProxyForPort: () => ({ server: "http://127.0.0.1:9", username: "user", password: "x" }),
  spawnRealChrome: async () => {
    chrome.spawns += 1
    await new Promise((resolve) => setTimeout(resolve, 20))
    chrome.listening = true
  },
  killSpawnedChrome: async () => {
    if (chrome.listening) chrome.kills += 1
    chrome.listening = false
  },
}))

vi.mock("../src/lib/wallapop-cdp/local-proxy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/wallapop-cdp/local-proxy")>()),
  hasLocalProxy: () => chrome.listening,
}))

vi.mock("../src/lib/wallapop-offline", () => ({
  assertWallapopOnline: () => {},
  isWallapopOffline: () => false,
}))

vi.mock("playwright", () => ({
  chromium: {
    connectOverCDP: async () => {
      const page = { isClosed: () => false, url: () => "about:blank", setDefaultTimeout: () => {} }
      const context = { pages: () => [page], newPage: async () => page }
      return {
        isConnected: () => true,
        contexts: () => [context],
        close: async () => {},
        newBrowserCDPSession: async () => ({ send: async () => ({}) }),
      }
    },
  },
}))

import { ATTACH_LIMIT_MS, oneAttachAtATime } from "../src/lib/wallapop-cdp/attach-queue"
import {
  abortInFlightPublish,
  ensureCdpAttached,
  ensureWallapopPage,
  ensureWorkerWindow,
  isBrowserMonitorBusy,
  isBrowserPublishBusy,
  isPublishAbortedError,
  resetWallapopPublishAbortForTests,
  runWithBrowserBusy,
  setWallapopHandle,
  type WallapopBrowserHandle,
} from "../src/lib/wallapop-cdp"
import { WINDOW_CALL_MS } from "../src/lib/wallapop-cdp/window-size"

const PORT = 9298
const never = () => new Promise<never>(() => {})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

type FakeOptions = {
  newSession?: () => Promise<unknown>
  newPage?: () => Promise<unknown>
  pages?: () => unknown[]
}

function fakeHandle(options: FakeOptions = {}): WallapopBrowserHandle {
  const upload = {
    isClosed: () => false,
    url: () => "https://es.wallapop.com/app/catalog/upload",
    close: never,
  }
  return {
    browser: {
      isConnected: () => true,
      newBrowserCDPSession: options.newSession ?? never,
    },
    context: {
      pages: options.pages ?? (() => []),
      newPage: options.newPage ?? never,
    },
    page: upload,
    ownedPage: true,
  } as unknown as WallapopBrowserHandle
}

/** Settled state of a promise that must not throw into the test on its own. */
function track<T>(promise: Promise<T>) {
  const state: { done: boolean; error: unknown; value: T | undefined } = {
    done: false,
    error: undefined,
    value: undefined,
  }
  promise.then(
    (value) => {
      state.done = true
      state.value = value
    },
    (error: unknown) => {
      state.done = true
      state.error = error
    },
  )
  return state
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  resetWallapopPublishAbortForTests()
  setWallapopHandle(null, PORT)
})

describe("two jobs attach to one Chrome (VPS 2026-11-04 18:31Z)", () => {
  beforeEach(() => {
    chrome.listening = false
    chrome.spawns = 0
    chrome.kills = 0
    vi.stubGlobal("fetch", async () => {
      if (!chrome.listening) throw new Error("not listening")
      return { ok: true, json: async () => ({}) }
    })
  })

  it("spawns one Chrome, kills none, and both jobs share it", async () => {
    const [first, second] = await Promise.all([ensureCdpAttached(PORT), ensureCdpAttached(PORT)])
    expect(chrome.spawns).toBe(1)
    expect(chrome.kills).toBe(0)
    expect(second.browser).toBe(first.browser)
  })

  it("does not relaunch for the job that arrives while the first is spawning", async () => {
    const first = ensureCdpAttached(PORT)
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = ensureCdpAttached(PORT)
    await Promise.all([first, second])
    expect(chrome.spawns).toBe(1)
    expect(chrome.kills).toBe(0)
  })
})

describe("oneAttachAtATime", () => {
  it("runs attaches on one port strictly one after another", async () => {
    const order: string[] = []
    const gate = deferred<void>()
    const first = oneAttachAtATime(PORT, async () => {
      order.push("first start")
      await gate.promise
      order.push("first end")
    })
    const second = oneAttachAtATime(PORT, async () => {
      order.push("second")
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(order).toEqual(["first start"])
    gate.resolve()
    await Promise.all([first, second])
    expect(order).toEqual(["first start", "first end", "second"])
  })

  it("does not make another port wait: PRO and the duplicate stay independent", async () => {
    const gate = deferred<void>()
    const first = oneAttachAtATime(PORT, () => gate.promise)
    await expect(oneAttachAtATime(PORT + 1, async () => "other")).resolves.toBe("other")
    gate.resolve()
    await first
  })

  it("lets the next attach run after one fails", async () => {
    const failed = oneAttachAtATime(PORT, async () => {
      throw new Error("spawn failed")
    })
    const next = oneAttachAtATime(PORT, async () => "ok")
    await expect(failed).rejects.toThrow("spawn failed")
    await expect(next).resolves.toBe("ok")
  })

  it("turns an attach that never returns into an error and moves the queue", async () => {
    vi.useFakeTimers()
    const hung = track(oneAttachAtATime(PORT, never))
    const next = track(oneAttachAtATime(PORT, async () => "ok"))
    await vi.advanceTimersByTimeAsync(ATTACH_LIMIT_MS - 1)
    expect(hung.done).toBe(false)
    expect(next.done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(String(hung.error)).toMatch(/CDP attach timed out/)
    expect(next.value).toBe("ok")
  })
})

describe("a window call that never returns", () => {
  it("becomes an ordinary error and frees the publish slot", async () => {
    vi.useFakeTimers()
    setWallapopHandle(fakeHandle(), PORT)
    const run = track(runWithBrowserBusy("publish", () => ensureWallapopPage(PORT), PORT))
    await vi.advanceTimersByTimeAsync(1)
    expect(isBrowserPublishBusy(PORT)).toBe(true)
    await vi.advanceTimersByTimeAsync(40_000)
    expect(run.done).toBe(true)
    expect(String(run.error)).toMatch(/New tab timed out/)
    expect(isPublishAbortedError(run.error)).toBe(false)
    expect(isBrowserPublishBusy(PORT)).toBe(false)
  })

  it("does not end a call that is merely slow", async () => {
    vi.useFakeTimers()
    const session = deferred<unknown>()
    setWallapopHandle(fakeHandle({ newSession: () => session.promise }), PORT)
    const run = track(runWithBrowserBusy("publish", () => ensureWallapopPage(PORT), PORT))
    await vi.advanceTimersByTimeAsync(WINDOW_CALL_MS - 1)
    expect(run.done).toBe(false)
    expect(isBrowserPublishBusy(PORT)).toBe(true)
  })
})

describe("Stop on a hung window call", () => {
  it("ends the publish at once and frees the slot", async () => {
    vi.useFakeTimers()
    setWallapopHandle(fakeHandle(), PORT)
    const run = track(runWithBrowserBusy("publish", () => ensureWallapopPage(PORT), PORT))
    await vi.advanceTimersByTimeAsync(1)
    const stop = track(abortInFlightPublish(PORT))
    await vi.advanceTimersByTimeAsync(0)
    expect(isPublishAbortedError(run.error)).toBe(true)
    expect(isBrowserPublishBusy(PORT)).toBe(false)
    await vi.advanceTimersByTimeAsync(8_000)
    expect(stop.done).toBe(true)
    expect(stop.error).toBeUndefined()
  })

  it("leaves the monitor on the same Chrome alone", async () => {
    vi.useFakeTimers()
    setWallapopHandle(fakeHandle(), PORT)
    const publish = track(runWithBrowserBusy("publish", () => ensureWallapopPage(PORT), PORT))
    const monitor = track(runWithBrowserBusy("monitor", () => ensureWorkerWindow("monitor", PORT), PORT))
    await vi.advanceTimersByTimeAsync(1)
    void abortInFlightPublish(PORT)
    await vi.advanceTimersByTimeAsync(0)
    expect(isPublishAbortedError(publish.error)).toBe(true)
    expect(monitor.done).toBe(false)
    expect(isBrowserMonitorBusy(PORT)).toBe(true)
    await vi.advanceTimersByTimeAsync(40_000)
    expect(String(monitor.error)).toMatch(/timed out/)
    expect(isPublishAbortedError(monitor.error)).toBe(false)
    expect(isBrowserMonitorBusy(PORT)).toBe(false)
  })

  it("closes a window that opens after the Stop", async () => {
    vi.useFakeTimers()
    const created = deferred<{ targetId?: string }>()
    const close = vi.fn(async () => {})
    const session = { send: async () => ({}), detach: async () => {} }
    const late = {
      isClosed: () => false,
      url: () => "about:blank",
      setDefaultTimeout: () => {},
      bringToFront: async () => {},
      close,
      context: () => ({ newCDPSession: async () => session }),
    }
    let opened = false
    setWallapopHandle(
      fakeHandle({
        newSession: async () => ({
          send: async () => {
            const value = await created.promise
            opened = true
            return value
          },
        }),
        pages: () => (opened ? [late] : []),
      }),
      PORT,
    )
    const run = track(runWithBrowserBusy("publish", () => ensureWallapopPage(PORT), PORT))
    await vi.advanceTimersByTimeAsync(1)
    void abortInFlightPublish(PORT)
    await vi.advanceTimersByTimeAsync(0)
    expect(isPublishAbortedError(run.error)).toBe(true)
    created.resolve({})
    await vi.advanceTimersByTimeAsync(200)
    expect(close).toHaveBeenCalledTimes(1)
  })
})

describe("the normal path is unchanged", () => {
  it("opens the job window and hands back its page", async () => {
    vi.useFakeTimers()
    const session = { send: async () => ({ targetInfo: { targetId: "T1" } }), detach: async () => {} }
    const page = {
      isClosed: () => false,
      url: () => "about:blank",
      setDefaultTimeout: () => {},
      bringToFront: async () => {},
      context: () => ({ newCDPSession: async () => session }),
    }
    let opened = false
    setWallapopHandle(
      fakeHandle({
        newSession: async () => ({
          send: async () => {
            opened = true
            return { targetId: "T1" }
          },
        }),
        pages: () => (opened ? [page] : []),
      }),
      PORT,
    )
    const run = track(runWithBrowserBusy("publish", () => ensureWallapopPage(PORT), PORT))
    await vi.advanceTimersByTimeAsync(200)
    expect(run.error).toBeUndefined()
    expect(run.value).toBe(page)
    expect(isBrowserPublishBusy(PORT)).toBe(false)
  })
})
