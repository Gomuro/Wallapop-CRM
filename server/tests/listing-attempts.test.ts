import { describe, expect, it, vi } from "vitest"

import { canRequeueListing } from "../../lib/inventory/listing-active"
import { buildUpsertUpdate } from "../src/routes/product-listings"
import { revertPublishClaim } from "../src/routes/product-publish-claim"
import {
  attemptsExhaustedMessage,
  exhaustedAttemptsWhere,
  failExhaustedListings,
} from "../src/lib/wallapop-listing-attempts"
import { autopostEligibleListingWhere } from "../src/lib/wallapop-autopost/pick"
import { recoverStalePostingListings } from "../src/lib/wallapop-posting-watchdog"

describe("attempt limit", () => {
  it("targets only queue rows that used up their attempts", () => {
    expect(exhaustedAttemptsWhere(3)).toEqual({
      status: "READY_TO_POST",
      postingAttempts: { gte: 3 },
    })
  })

  it("names the limit and the way out in the reason", () => {
    const message = attemptsExhaustedMessage(3)
    expect(message).toContain("3 intentos")
    expect(message).toContain("Poner en cola")
  })

  it("moves exhausted rows to FAILED and keeps the reason", async () => {
    const updateManyAndReturn = vi.fn(async () => [
      { id: "l1", productId: "p1", accountId: "a1", postingAttempts: 3 },
      { id: "l2", productId: "p2", accountId: "a1", postingAttempts: 4 },
    ])
    const paused = await failExhaustedListings(
      { productListing: { updateManyAndReturn } } as never,
      3,
    )
    expect(paused).toBe(2)
    expect(updateManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "READY_TO_POST", postingAttempts: { gte: 3 } },
        data: { status: "FAILED", lastPublishError: attemptsExhaustedMessage(3) },
      }),
    )
  })

  it("reports 0 when nothing is exhausted", async () => {
    const updateManyAndReturn = vi.fn(async () => [])
    expect(
      await failExhaustedListings({ productListing: { updateManyAndReturn } } as never, 3),
    ).toBe(0)
  })
})

describe("autopost pick skips paused rows", () => {
  it("only takes READY_TO_POST, so FAILED is never picked", () => {
    expect(autopostEligibleListingWhere("acc").status).toBe("READY_TO_POST")
  })
})

describe("watchdog tick safety", () => {
  it("still returns when the attempts sweep throws", async () => {
    const prisma = {
      productListing: {
        updateManyAndReturn: vi.fn(async () => {
          throw new Error("db down")
        }),
        findMany: vi.fn(async () => []),
        update: vi.fn(),
      },
    }
    const result = await recoverStalePostingListings(prisma as never, {
      busy: "idle",
      chromeAlive: true,
      pageClosed: false,
      maxAttempts: 3,
    })
    expect(result).toEqual({ recovered: 0, failed: 0, skipped: false })
  })

  it("runs the sweep with the configured limit before the stale check", async () => {
    const updateManyAndReturn = vi.fn(async () => [])
    const prisma = {
      productListing: { updateManyAndReturn, findMany: vi.fn(async () => []), update: vi.fn() },
    }
    await recoverStalePostingListings(prisma as never, {
      busy: "publish",
      chromeAlive: true,
      pageClosed: false,
      maxAttempts: 2,
    })
    expect(updateManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({ where: exhaustedAttemptsWhere(2) }),
    )
  })
})

describe("attempts are not reset by a rollback", () => {
  it("revert after a failed publish only changes the status", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }))
    await revertPublishClaim({ productListing: { updateMany } } as never, "p", "a")
    expect(updateMany).toHaveBeenCalledWith({
      where: { productId: "p", accountId: "a", status: "POSTING" },
      data: { status: "READY_TO_POST" },
    })
  })
})

describe("manual retry", () => {
  it("putting a listing back in the queue resets attempts and the reason", () => {
    const data = buildUpsertUpdate({ status: "READY_TO_POST" } as never)
    expect(data).toMatchObject({
      status: "READY_TO_POST",
      postingAttempts: 0,
      lastPublishError: null,
    })
  })

  it("other status changes leave the counters alone", () => {
    const data = buildUpsertUpdate({ status: "DEACTIVATED" } as never)
    expect(data).not.toHaveProperty("postingAttempts")
    expect(data).not.toHaveProperty("lastPublishError")
  })

  it("the UI offers the retry button on a FAILED listing", () => {
    const product = { status: "ACTIVE" } as never
    expect(canRequeueListing(product, { status: "FAILED" } as never)).toBe(true)
    expect(canRequeueListing(product, { status: "ACTIVE" } as never)).toBe(false)
  })
})
