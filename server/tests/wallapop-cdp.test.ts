import { describe, expect, it } from "vitest"

import {
  isClosedPage,
  isHandleAlive,
  isLoginOr2faUrl,
  isWallFeedUrl,
  pickLiveSessionPage,
  shouldCloseUploadTab,
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
