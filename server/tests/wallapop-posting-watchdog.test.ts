import { afterEach, describe, expect, it, vi } from "vitest"

import {
  classifyStalePostingReason,
  DEFAULT_POSTING_MAX_ATTEMPTS,
  DEFAULT_POSTING_STALE_MS,
  readPostingMaxAttempts,
  readPostingStaleMs,
  recoverStalePostingListings,
  statusAfterStalePosting,
} from "../src/lib/wallapop-posting-watchdog"

describe("readPostingStaleMs", () => {
  const prev = process.env.WALLAPOP_POSTING_STALE_MS

  afterEach(() => {
    if (prev === undefined) delete process.env.WALLAPOP_POSTING_STALE_MS
    else process.env.WALLAPOP_POSTING_STALE_MS = prev
  })

  it("defaults to 20 minutes and rejects non-positive values", () => {
    delete process.env.WALLAPOP_POSTING_STALE_MS
    expect(readPostingStaleMs()).toBe(DEFAULT_POSTING_STALE_MS)
    expect(DEFAULT_POSTING_STALE_MS).toBe(20 * 60 * 1000)

    process.env.WALLAPOP_POSTING_STALE_MS = "60000"
    expect(readPostingStaleMs()).toBe(60000)

    process.env.WALLAPOP_POSTING_STALE_MS = "0"
    expect(readPostingStaleMs()).toBe(DEFAULT_POSTING_STALE_MS)
  })
})

describe("readPostingMaxAttempts", () => {
  const prev = process.env.WALLAPOP_POSTING_MAX_ATTEMPTS

  afterEach(() => {
    if (prev === undefined) delete process.env.WALLAPOP_POSTING_MAX_ATTEMPTS
    else process.env.WALLAPOP_POSTING_MAX_ATTEMPTS = prev
  })

  it("defaults to 3 and rejects values below 1", () => {
    delete process.env.WALLAPOP_POSTING_MAX_ATTEMPTS
    expect(readPostingMaxAttempts()).toBe(DEFAULT_POSTING_MAX_ATTEMPTS)
    expect(DEFAULT_POSTING_MAX_ATTEMPTS).toBe(3)

    process.env.WALLAPOP_POSTING_MAX_ATTEMPTS = "5"
    expect(readPostingMaxAttempts()).toBe(5)

    process.env.WALLAPOP_POSTING_MAX_ATTEMPTS = "0"
    expect(readPostingMaxAttempts()).toBe(DEFAULT_POSTING_MAX_ATTEMPTS)
  })
})

describe("classifyStalePostingReason", () => {
  it("does not recover while a live publish holds Chrome", () => {
    expect(
      classifyStalePostingReason({
        busy: "publish",
        chromeAlive: false,
        pageClosed: true,
      }),
    ).toBeNull()
  })

  it("logs chrome_dead when CDP is gone", () => {
    expect(
      classifyStalePostingReason({
        busy: "idle",
        chromeAlive: false,
        pageClosed: false,
      }),
    ).toBe("chrome_dead")
  })

  it("logs target_closed when Chrome is up but the page is gone", () => {
    expect(
      classifyStalePostingReason({
        busy: "idle",
        chromeAlive: true,
        pageClosed: true,
      }),
    ).toBe("target_closed")
  })

  it("logs timeout when Chrome is idle and still connected", () => {
    expect(
      classifyStalePostingReason({
        busy: "idle",
        chromeAlive: true,
        pageClosed: false,
      }),
    ).toBe("timeout")
  })

  it("does not treat sold as an in-flight publish", () => {
    expect(
      classifyStalePostingReason({
        busy: "sold",
        chromeAlive: true,
        pageClosed: false,
      }),
    ).toBe("timeout")
  })
})

describe("statusAfterStalePosting", () => {
  it("re-queues until the attempt cap, then FAILED", () => {
    expect(statusAfterStalePosting(1, 3)).toBe("READY_TO_POST")
    expect(statusAfterStalePosting(2, 3)).toBe("READY_TO_POST")
    expect(statusAfterStalePosting(3, 3)).toBe("FAILED")
    expect(statusAfterStalePosting(4, 3)).toBe("FAILED")
  })
})

describe("recoverStalePostingListings", () => {
  it("skips DB writes while publish is in flight", async () => {
    const findMany = vi.fn()
    const prisma = { productListing: { findMany, update: vi.fn() } }

    const result = await recoverStalePostingListings(prisma as never, {
      busy: "publish",
      chromeAlive: false,
      pageClosed: false,
    })

    expect(result).toEqual({ recovered: 0, failed: 0, skipped: true })
    expect(findMany).not.toHaveBeenCalled()
  })

  it("reverts stale POSTING to READY_TO_POST under the attempt cap", async () => {
    const update = vi.fn().mockResolvedValue({})
    const prisma = {
      productListing: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "l1",
            productId: "p1",
            postingAttempts: 1,
            product: { sku: "SKU-1" },
          },
        ]),
        update,
      },
    }

    const result = await recoverStalePostingListings(prisma as never, {
      busy: "idle",
      chromeAlive: false,
      pageClosed: false,
      now: new Date("2026-10-07T12:00:00.000Z"),
      staleMs: 60_000,
      maxAttempts: 3,
    })

    expect(result).toEqual({ recovered: 1, failed: 0, skipped: false })
    expect(update).toHaveBeenCalledWith({
      where: { id: "l1" },
      data: { status: "READY_TO_POST", lastPublishError: "chrome_dead" },
    })
  })

  it("marks FAILED after the attempt cap", async () => {
    const update = vi.fn().mockResolvedValue({})
    const prisma = {
      productListing: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "l2",
            productId: "p2",
            postingAttempts: 3,
            product: { sku: "SKU-2" },
          },
        ]),
        update,
      },
    }

    const result = await recoverStalePostingListings(prisma as never, {
      busy: "idle",
      chromeAlive: true,
      pageClosed: true,
      now: new Date("2026-10-07T12:00:00.000Z"),
      staleMs: 60_000,
      maxAttempts: 3,
    })

    expect(result).toEqual({ recovered: 0, failed: 1, skipped: false })
    expect(update).toHaveBeenCalledWith({
      where: { id: "l2" },
      data: { status: "FAILED", lastPublishError: "target_closed" },
    })
  })
})
