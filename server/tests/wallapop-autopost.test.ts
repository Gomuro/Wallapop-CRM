import { afterEach, describe, expect, it, vi } from "vitest"

import {
  AUTOPOST_PICK_ORDER_BY,
  AUTOPOST_JITTER_FRACTION,
  autopostDelayWithJitter,
  autopostEligibleListingWhere,
  DEFAULT_AUTOPOST_INTERVAL_MS,
  isAutopostLivePublishEnabled,
  isWallapopAutopostEnabled,
  getNextAutopostTickAt,
  isWallapopAutopostLoopScheduling,
  pickNextAutopostListing,
  readAutopostIntervalMs,
  resolveAutopostInterval,
  rescheduleAutopostLoop,
  resetWallapopAutopostLoopForTests,
  runAutopostTick,
  startWallapopAutopostLoop,
} from "../src/lib/wallapop-autopost"
import {
  getRecentAutopostSkips,
  resetAutopostRecentSkipsForTests,
} from "../src/lib/autopost-recent-skips"
import {
  AUTOPOST_INTERVAL_RANGE_MESSAGE,
  autopostIntervalPatchSchema,
  msToAutopostIntervalInput,
} from "../../lib/validations/account"

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

describe("resolveAutopostInterval", () => {
  const prev = process.env.WALLAPOP_AUTOPOST_INTERVAL_MS

  afterEach(() => {
    if (prev === undefined) delete process.env.WALLAPOP_AUTOPOST_INTERVAL_MS
    else process.env.WALLAPOP_AUTOPOST_INTERVAL_MS = prev
  })

  function mockPrisma(stored: number | null) {
    return {
      account: {
        findFirst: async () => ({ autopostIntervalMs: stored }),
      },
    } as never
  }

  it("prefers a stored account interval over env", async () => {
    process.env.WALLAPOP_AUTOPOST_INTERVAL_MS = "120000"
    const result = await resolveAutopostInterval(mockPrisma(300000))
    expect(result).toEqual({
      effectiveIntervalMs: 300000,
      source: "account",
      storedIntervalMs: 300000,
    })
  })

  it("uses env when the account column is null", async () => {
    process.env.WALLAPOP_AUTOPOST_INTERVAL_MS = "120000"
    const result = await resolveAutopostInterval(mockPrisma(null))
    expect(result).toEqual({
      effectiveIntervalMs: 120000,
      source: "env",
      storedIntervalMs: null,
    })
  })

  it("falls back to 15 minutes when account and env are empty", async () => {
    delete process.env.WALLAPOP_AUTOPOST_INTERVAL_MS
    const result = await resolveAutopostInterval(mockPrisma(null))
    expect(result).toEqual({
      effectiveIntervalMs: DEFAULT_AUTOPOST_INTERVAL_MS,
      source: "default",
      storedIntervalMs: null,
    })
  })

  it("ignores non-positive stored values", async () => {
    delete process.env.WALLAPOP_AUTOPOST_INTERVAL_MS
    const result = await resolveAutopostInterval(mockPrisma(0))
    expect(result.source).toBe("default")
  })
})

describe("autopost interval input", () => {
  it("splits milliseconds into the coarsest even unit", () => {
    expect(msToAutopostIntervalInput(900000)).toEqual({
      value: 15,
      unit: "minutes",
    })
    expect(msToAutopostIntervalInput(3600000)).toEqual({
      value: 1,
      unit: "hours",
    })
  })

  it("rejects PATCH values outside 1 minute … 7 days", () => {
    expect(
      autopostIntervalPatchSchema.safeParse({
        value: 30,
        unit: "seconds",
      }).success,
    ).toBe(false)
    expect(
      autopostIntervalPatchSchema.safeParse({
        value: 8,
        unit: "days",
      }).success,
    ).toBe(false)

    const tooShort = autopostIntervalPatchSchema.safeParse({
      value: 30,
      unit: "seconds",
    })
    expect(tooShort.success).toBe(false)
    if (!tooShort.success) {
      expect(tooShort.error.issues[0]?.message).toBe(
        AUTOPOST_INTERVAL_RANGE_MESSAGE,
      )
    }

    expect(
      autopostIntervalPatchSchema.parse({ value: 15, unit: "minutes" }),
    ).toEqual({ value: 15, unit: "minutes" })
  })
})

describe("autopostDelayWithJitter", () => {
  it("spreads ±20% around the base interval", () => {
    const base = 1000
    expect(AUTOPOST_JITTER_FRACTION).toBe(0.2)
    expect(autopostDelayWithJitter(base, () => 0)).toBe(800)
    expect(autopostDelayWithJitter(base, () => 0.5)).toBe(1000)
    expect(autopostDelayWithJitter(base, () => 1)).toBe(1200)
  })
})

describe("autopostEligibleListingWhere", () => {
  it("allows READY_TO_POST without a public /item/ URL", () => {
    expect(autopostEligibleListingWhere("acc-1")).toMatchObject({
      accountId: "acc-1",
      status: "READY_TO_POST",
      OR: [
        { externalUrl: null },
        { NOT: { externalUrl: { contains: "/item/" } } },
      ],
    })
  })
})

describe("pickNextAutopostListing", () => {
  afterEach(() => {
    resetAutopostRecentSkipsForTests()
  })

  it("skips listings without peso and returns the next ready one", async () => {
    const prisma = {
      productListing: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "l-bad",
            productId: "p-bad",
            createdAt: new Date("2026-01-01"),
            product: {
              sku: "SKU-BAD",
              title: "Caja sin peso",
              weightKg: null,
              widthCm: null,
              lengthCm: null,
              heightCm: null,
            },
          },
          {
            id: "l-good",
            productId: "p-good",
            createdAt: new Date("2026-01-02"),
            product: {
              sku: "SKU-GOOD",
              title: "Caja con peso",
              weightKg: 1.2,
              widthCm: null,
              lengthCm: null,
              heightCm: null,
            },
          },
        ]),
      },
    }

    const picked = await pickNextAutopostListing(
      prisma as never,
      "acc-1",
    )
    expect(picked.listing).toMatchObject({
      id: "l-good",
      productId: "p-good",
    })
    expect(picked.skipped).toBe(1)
    expect(getRecentAutopostSkips()[0]).toMatchObject({
      productId: "p-bad",
      sku: "SKU-BAD",
      code: "SHIPPING_NOT_READY",
    })
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
  afterEach(() => {
    vi.useRealTimers()
    resetWallapopAutopostLoopForTests()
  })

  it("schedules timers even when WALLAPOP_AUTOPOST is not true", async () => {
    vi.useFakeTimers()
    delete process.env.WALLAPOP_AUTOPOST
    startWallapopAutopostLoop()
    await Promise.resolve()
    expect(isWallapopAutopostLoopScheduling()).toBe(true)
    vi.clearAllTimers()
  })

  it("exposes next tick time when scheduling", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"))
    resetWallapopAutopostLoopForTests()
    delete process.env.WALLAPOP_AUTOPOST_INTERVAL_MS
    startWallapopAutopostLoop()
    await vi.waitFor(() => {
      expect(getNextAutopostTickAt()).not.toBeNull()
    })

    const at = getNextAutopostTickAt()
    expect(at).not.toBeNull()
    const remainingMs = new Date(at!).getTime() - Date.now()
    const minMs = DEFAULT_AUTOPOST_INTERVAL_MS * (1 - AUTOPOST_JITTER_FRACTION)
    const maxMs = DEFAULT_AUTOPOST_INTERVAL_MS * (1 + AUTOPOST_JITTER_FRACTION)
    expect(remainingMs).toBeGreaterThanOrEqual(Math.floor(minMs) - 1)
    expect(remainingMs).toBeLessThanOrEqual(Math.ceil(maxMs) + 1)

    vi.clearAllTimers()
  })

  it("rescheduleAutopostLoop restarts the wait from now", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"))
    resetWallapopAutopostLoopForTests()
    delete process.env.WALLAPOP_AUTOPOST_INTERVAL_MS
    startWallapopAutopostLoop()
    await vi.waitFor(() => {
      expect(getNextAutopostTickAt()).not.toBeNull()
    })

    const firstRemaining =
      new Date(getNextAutopostTickAt()!).getTime() - Date.now()
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    const midRemaining =
      new Date(getNextAutopostTickAt()!).getTime() - Date.now()
    expect(midRemaining).toBeLessThan(firstRemaining)

    await rescheduleAutopostLoop()
    const remainingMs = new Date(getNextAutopostTickAt()!).getTime() - Date.now()
    expect(remainingMs).toBeGreaterThan(midRemaining)
    const minMs = DEFAULT_AUTOPOST_INTERVAL_MS * (1 - AUTOPOST_JITTER_FRACTION)
    const maxMs = DEFAULT_AUTOPOST_INTERVAL_MS * (1 + AUTOPOST_JITTER_FRACTION)
    expect(remainingMs).toBeGreaterThanOrEqual(Math.floor(minMs) - 1)
    expect(remainingMs).toBeLessThanOrEqual(Math.ceil(maxMs) + 1)

    vi.clearAllTimers()
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
