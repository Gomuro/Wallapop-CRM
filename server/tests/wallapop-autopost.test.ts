import { afterEach, describe, expect, it, vi } from "vitest"

import {
  AUTOPOST_PICK_ORDER_BY,
  autopostDelayWithJitter,
  autopostEligibleListingWhere,
  DEFAULT_AUTOPOST_INTERVAL_MS,
  isAutopostLivePublishEnabled,
  isWallapopAutopostEnabled,
  isWallapopAutopostLoopScheduling,
  readAutopostIntervalMs,
  runAutopostTick,
  startWallapopAutopostLoop,
} from "../src/lib/wallapop-autopost"

describe("isWallapopAutopostEnabled", () => {
  const prev = process.env.WALLAPOP_AUTOPOST

  afterEach(() => {
    if (prev === undefined) delete process.env.WALLAPOP_AUTOPOST
    else process.env.WALLAPOP_AUTOPOST = prev
  })

  it("is off unless the env value is exactly true", () => {
    delete process.env.WALLAPOP_AUTOPOST
    expect(isWallapopAutopostEnabled()).toBe(false)

    process.env.WALLAPOP_AUTOPOST = "1"
    expect(isWallapopAutopostEnabled()).toBe(false)

    process.env.WALLAPOP_AUTOPOST = "TRUE"
    expect(isWallapopAutopostEnabled()).toBe(false)

    process.env.WALLAPOP_AUTOPOST = "true"
    expect(isWallapopAutopostEnabled()).toBe(true)
  })
})

describe("readAutopostIntervalMs", () => {
  const prev = process.env.WALLAPOP_AUTOPOST_INTERVAL_MS

  afterEach(() => {
    if (prev === undefined) delete process.env.WALLAPOP_AUTOPOST_INTERVAL_MS
    else process.env.WALLAPOP_AUTOPOST_INTERVAL_MS = prev
  })

  it("defaults to 15 minutes and rejects non-positive values", () => {
    delete process.env.WALLAPOP_AUTOPOST_INTERVAL_MS
    expect(readAutopostIntervalMs()).toBe(DEFAULT_AUTOPOST_INTERVAL_MS)
    expect(DEFAULT_AUTOPOST_INTERVAL_MS).toBe(15 * 60 * 1000)

    process.env.WALLAPOP_AUTOPOST_INTERVAL_MS = "120000"
    expect(readAutopostIntervalMs()).toBe(120000)

    process.env.WALLAPOP_AUTOPOST_INTERVAL_MS = "0"
    expect(readAutopostIntervalMs()).toBe(DEFAULT_AUTOPOST_INTERVAL_MS)

    process.env.WALLAPOP_AUTOPOST_INTERVAL_MS = "nope"
    expect(readAutopostIntervalMs()).toBe(DEFAULT_AUTOPOST_INTERVAL_MS)
  })
})

describe("autopostDelayWithJitter", () => {
  it("spreads ±20% around the base interval", () => {
    const base = 1000
    expect(autopostDelayWithJitter(base, () => 0)).toBe(800)
    expect(autopostDelayWithJitter(base, () => 0.5)).toBe(1000)
    expect(autopostDelayWithJitter(base, () => 1)).toBe(1200)
  })
})

describe("autopostEligibleListingWhere", () => {
  it("picks oldest READY_TO_POST on the account with an active product and images", () => {
    expect(autopostEligibleListingWhere("acc-1")).toEqual({
      accountId: "acc-1",
      status: "READY_TO_POST",
      externalUrl: null,
      product: {
        status: "ACTIVE",
        images: { some: {} },
      },
    })
    expect(AUTOPOST_PICK_ORDER_BY).toEqual({ createdAt: "asc" })
  })
})

describe("isAutopostLivePublishEnabled", () => {
  const prev = process.env.WALLAPOP_PUBLISH_DRY_RUN

  afterEach(() => {
    if (prev === undefined) delete process.env.WALLAPOP_PUBLISH_DRY_RUN
    else process.env.WALLAPOP_PUBLISH_DRY_RUN = prev
  })

  it("is off unless WALLAPOP_PUBLISH_DRY_RUN is exactly false", () => {
    delete process.env.WALLAPOP_PUBLISH_DRY_RUN
    expect(isAutopostLivePublishEnabled()).toBe(false)

    process.env.WALLAPOP_PUBLISH_DRY_RUN = "true"
    expect(isAutopostLivePublishEnabled()).toBe(false)

    process.env.WALLAPOP_PUBLISH_DRY_RUN = "FALSE"
    expect(isAutopostLivePublishEnabled()).toBe(false)

    process.env.WALLAPOP_PUBLISH_DRY_RUN = "false"
    expect(isAutopostLivePublishEnabled()).toBe(true)
  })
})

describe("startWallapopAutopostLoop", () => {
  const prev = process.env.WALLAPOP_AUTOPOST

  afterEach(() => {
    if (prev === undefined) delete process.env.WALLAPOP_AUTOPOST
    else process.env.WALLAPOP_AUTOPOST = prev
  })

  it("is a no-op when env is not exactly true (no timers)", () => {
    process.env.WALLAPOP_AUTOPOST = "false"
    startWallapopAutopostLoop()
    expect(isWallapopAutopostLoopScheduling()).toBe(false)
  })
})

describe("runAutopostTick dry-run skip", () => {
  const prev = process.env.WALLAPOP_PUBLISH_DRY_RUN

  afterEach(() => {
    if (prev === undefined) delete process.env.WALLAPOP_PUBLISH_DRY_RUN
    else process.env.WALLAPOP_PUBLISH_DRY_RUN = prev
  })

  it("does not schedule publish when dry-run is not exactly false", async () => {
    const publish = vi.fn()

    delete process.env.WALLAPOP_PUBLISH_DRY_RUN
    await runAutopostTick(publish)
    expect(publish).not.toHaveBeenCalled()

    process.env.WALLAPOP_PUBLISH_DRY_RUN = "true"
    await runAutopostTick(publish)
    expect(publish).not.toHaveBeenCalled()
  })
})
