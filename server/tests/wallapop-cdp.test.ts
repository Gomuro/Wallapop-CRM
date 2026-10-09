import { afterEach, describe, expect, it } from "vitest"

import {
  abortInFlightPublish,
  consumeKeepChromeAfterAbort,
  isBrowserBusyError,
  isBrowserPublishBusy,
  isBrowserMonitorBusy,
  isBrowserSessionBusy,
  isBrowserSoldBusy,
  isKeepChromeWarm,
  setKeepChromeWarm,
  isClosedPage,
  isHandleAlive,
  isInFlightPublishAborted,
  isLoginOr2faUrl,
  isPublishAbortedError,
  isWallFeedUrl,
  pickLiveSessionPage,
  resetWallapopPublishAbortForTests,
  runWithBrowserBusy,
  setWallapopHandle,
  shouldCloseUploadTab,
  throwIfPublishAborted,
  type WallapopBrowserHandle,
} from "../src/lib/wallapop-cdp"

describe("isLoginOr2faUrl", () => {
  it("guards accounts and login-actions tabs", () => {
    expect(
      isLoginOr2faUrl(
        "https://accounts.wallapop.com/realms/wallapop-internal/protocol/openid-connect/auth",
      ),
    ).toBe(true)
    expect(
      isLoginOr2faUrl(
        "https://accounts.wallapop.com/realms/wallapop-internal/login-actions/authenticate",
      ),
    ).toBe(true)
    expect(isLoginOr2faUrl("https://es.wallapop.com/wall")).toBe(false)
    expect(
      isLoginOr2faUrl("https://es.wallapop.com/app/catalog/upload"),
    ).toBe(false)
  })
})

describe("shouldCloseUploadTab", () => {
  it("closes only an owned non-login tab", () => {
    expect(
      shouldCloseUploadTab(true, "https://es.wallapop.com/app/catalog/upload"),
    ).toBe(true)
    expect(shouldCloseUploadTab(false, "https://es.wallapop.com/wall")).toBe(
      false,
    )
    expect(
      shouldCloseUploadTab(
        true,
        "https://accounts.wallapop.com/realms/wallapop-internal/login-actions/authenticate",
      ),
    ).toBe(false)
  })
})

describe("isClosedPage", () => {
  it("detects a closed Playwright page without throwing", () => {
    expect(isClosedPage({ isClosed: () => true })).toBe(true)
    expect(isClosedPage({ isClosed: () => false })).toBe(false)
    expect(
      isClosedPage({
        isClosed: () => {
          throw new Error("Target closed")
        },
      }),
    ).toBe(true)
  })
})

describe("pickLiveSessionPage", () => {
  it("prefers /wall, skips closed and login tabs, ignores leftover upload", () => {
    expect(
      pickLiveSessionPage([
        {
          url: "https://accounts.wallapop.com/realms/wallapop-internal/login-actions/authenticate",
          isClosed: false,
        },
        {
          url: "https://es.wallapop.com/app/catalog/upload",
          isClosed: true,
        },
        { url: "https://es.wallapop.com/wall", isClosed: false },
      ])?.url,
    ).toBe("https://es.wallapop.com/wall")
  })

  it("falls back to another live es.wallapop.com tab when /wall is gone", () => {
    expect(
      pickLiveSessionPage([
        { url: "chrome://newtab", isClosed: false },
        {
          url: "https://es.wallapop.com/app/catalog/upload",
          isClosed: false,
        },
      ])?.url,
    ).toBe("https://es.wallapop.com/app/catalog/upload")
  })

  it("returns null when only login or closed pages remain", () => {
    expect(
      pickLiveSessionPage([
        {
          url: "https://accounts.wallapop.com/realms/wallapop-internal/protocol/openid-connect/auth",
          isClosed: false,
        },
        { url: "https://es.wallapop.com/wall", isClosed: true },
      ]),
    ).toBeNull()
  })
})

describe("isHandleAlive", () => {
  it("is false when the Page is closed even if CDP is still connected", async () => {
    const handle = {
      browser: { isConnected: () => true },
      context: { pages: () => [] },
      page: { isClosed: () => true },
      ownedPage: false,
    } as unknown as WallapopBrowserHandle
    expect(await isHandleAlive(handle)).toBe(false)
  })

  it("is true when CDP is connected and the Page is open", async () => {
    const handle = {
      browser: { isConnected: () => true },
      context: { pages: () => [] },
      page: { isClosed: () => false },
      ownedPage: true,
    } as unknown as WallapopBrowserHandle
    expect(await isHandleAlive(handle)).toBe(true)
  })
})

describe("isWallFeedUrl", () => {
  it("matches the session feed, not wallet or upload", () => {
    expect(isWallFeedUrl("https://es.wallapop.com/wall")).toBe(true)
    expect(isWallFeedUrl("https://es.wallapop.com/wall?foo=1")).toBe(true)
    expect(isWallFeedUrl("https://es.wallapop.com/wallet")).toBe(false)
    expect(isWallFeedUrl("https://es.wallapop.com/app/catalog/upload")).toBe(
      false,
    )
  })
})

describe("abortInFlightPublish", () => {
  afterEach(() => {
    resetWallapopPublishAbortForTests()
    setWallapopHandle(null)
  })

  it("is a no-op when Chrome is idle", async () => {
    await abortInFlightPublish()
    expect(isInFlightPublishAborted()).toBe(false)
    expect(consumeKeepChromeAfterAbort()).toBe(false)
  })

  it("does not close an upload tab when idle", async () => {
    let closed = false
    const upload = {
      isClosed: () => closed,
      url: () => "https://es.wallapop.com/app/catalog/upload",
      close: async () => {
        closed = true
      },
    }
    setWallapopHandle({
      browser: { isConnected: () => true },
      context: { pages: () => [upload] },
      page: upload,
      ownedPage: true,
    } as unknown as WallapopBrowserHandle)

    await abortInFlightPublish()
    expect(closed).toBe(false)
  })

  it("closes the owned upload tab and keeps Chrome for the next Start", async () => {
    let closed = false
    const upload = {
      isClosed: () => closed,
      url: () => "https://es.wallapop.com/app/catalog/upload",
      close: async () => {
        closed = true
      },
      bringToFront: async () => {},
      setDefaultTimeout: () => {},
    }
    const wall = {
      isClosed: () => false,
      url: () => "https://es.wallapop.com/wall",
      bringToFront: async () => {},
      setDefaultTimeout: () => {},
      evaluate: async () => {},
      waitForTimeout: async () => {},
    }
    setWallapopHandle({
      browser: { isConnected: () => true },
      context: {
        pages: () => (closed ? [wall] : [wall, upload]),
        newPage: async () => wall,
      },
      page: upload,
      ownedPage: true,
    } as unknown as WallapopBrowserHandle)

    let markStarted!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    let releaseGate!: () => void
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })

    const run = runWithBrowserBusy("publish", async () => {
      markStarted()
      await gate
      throwIfPublishAborted()
    })

    await started
    await abortInFlightPublish()
    expect(closed).toBe(true)
    expect(isInFlightPublishAborted()).toBe(true)
    releaseGate()
    await expect(run).rejects.toSatisfy(isPublishAbortedError)
    expect(consumeKeepChromeAfterAbort()).toBe(true)
  })
})

describe("worker slots", () => {
  afterEach(() => {
    resetWallapopPublishAbortForTests()
  })

  it("allows publish, sold, and monitor together, not two monitors", async () => {
    let releasePublish!: () => void
    const publishGate = new Promise<void>((resolve) => {
      releasePublish = resolve
    })
    const publishRun = runWithBrowserBusy("publish", async () => {
      await publishGate
    })
    expect(isBrowserPublishBusy()).toBe(true)
    await runWithBrowserBusy("sold", async () => {
      expect(isBrowserSoldBusy()).toBe(true)
      expect(isBrowserPublishBusy()).toBe(true)
    })
    let releaseMonitor!: () => void
    const monitorGate = new Promise<void>((resolve) => {
      releaseMonitor = resolve
    })
    const monitorRun = runWithBrowserBusy("monitor", async () => {
      expect(isBrowserMonitorBusy()).toBe(true)
      expect(isBrowserPublishBusy()).toBe(true)
      await monitorGate
    })
    await expect(runWithBrowserBusy("monitor", async () => {})).rejects.toSatisfy(
      isBrowserBusyError,
    )
    await expect(runWithBrowserBusy("publish", async () => {})).rejects.toSatisfy(
      isBrowserBusyError,
    )
    releaseMonitor()
    await monitorRun
    releasePublish()
    await publishRun
    expect(isBrowserPublishBusy()).toBe(false)
    expect(isBrowserSoldBusy()).toBe(false)
  })

  it("blocks login while sold is running", async () => {
    let releaseSold!: () => void
    const soldGate = new Promise<void>((resolve) => {
      releaseSold = resolve
    })
    const soldRun = runWithBrowserBusy("sold", async () => {
      await soldGate
    })
    await expect(runWithBrowserBusy("login", async () => {})).rejects.toSatisfy(
      isBrowserBusyError,
    )
    releaseSold()
    await soldRun
  })

  it("treats session as a worker slot, not exclusive rehydrate", async () => {
    let releaseSession!: () => void
    const sessionGate = new Promise<void>((resolve) => {
      releaseSession = resolve
    })
    const sessionRun = runWithBrowserBusy("session", async () => {
      expect(isBrowserSessionBusy()).toBe(true)
      await sessionGate
    })
    await runWithBrowserBusy("monitor", async () => {
      expect(isBrowserMonitorBusy()).toBe(true)
    })
    await expect(runWithBrowserBusy("login", async () => {})).rejects.toSatisfy(
      isBrowserBusyError,
    )
    releaseSession()
    await sessionRun
  })

  it("keeps chrome warm for the monitor loop", () => {
    expect(isKeepChromeWarm()).toBe(false)
    setKeepChromeWarm(true)
    expect(isKeepChromeWarm()).toBe(true)
  })
})
