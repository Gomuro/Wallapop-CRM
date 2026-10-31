import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const W2 = "acc-w2"
const accountTicks: string[] = []

const loopDb = {
  account: {
    // Serves both the schedule gate and the stored interval lookup.
    findUnique: vi.fn(async () => ({ isDefault: false, autopostEnabled: true, autopostIntervalMs: 600_000 })),
  },
}

vi.mock("../src/lib/db", () => ({ getPrisma: () => loopDb }))

vi.mock("../src/lib/wallapop-autopost/tick", () => ({
  runAutopostTick: vi.fn(async () => false),
  // Every tick sees an empty queue.
  runAccountAutopostTick: vi.fn(async (accountId: string) => {
    accountTicks.push(accountId)
    return false
  }),
}))

vi.mock("../src/lib/listing-variant/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/listing-variant/store")>()),
  buildListingVariant: vi.fn(async () => ({
    ok: true,
    data: {
      variantTitle: "Titulo",
      variantDescription: "Descripcion",
      variantPrice: 9.98,
      variantSource: "ai",
      variantBasis: "basis",
      variantGeneratedAt: new Date(),
      variantError: null,
    },
  })),
}))

const { accountNextTickAt } = await import("../src/lib/wallapop-autopost/desk")
const { pauseAccountAutopost, scheduleAccountAutopost } = await import("../src/lib/wallapop-autopost/loop")
const { processPendingVariants } = await import("../src/lib/listing-variant/worker")

/** One PREPARING duplicate on W2 that the writer turns READY on each run. */
const workerDb = {
  productListing: {
    findMany: vi.fn(async () => [{ productId: "p1", accountId: W2, status: "PREPARING", variantAttempts: 0 }]),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  product: { findUnique: vi.fn(async () => ({ price: { toString: () => "10.00" } })) },
}

describe("autopost schedule", () => {
  beforeEach(() => {
    accountTicks.length = 0
    vi.useFakeTimers()
    vi.spyOn(Math, "random").mockReturnValue(0.5) // no jitter: exactly the interval
  })

  afterEach(() => {
    pauseAccountAutopost(W2)
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it("W2 ticks on time while the text writer runs every 5 min, and an empty queue keeps the loop", async () => {
    await scheduleAccountAutopost(W2)
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(5 * 60_000)
      await processPendingVariants(workerDb as never)
    }
    expect(workerDb.productListing.updateMany).toHaveBeenCalledTimes(4)
    expect(accountTicks).toEqual([W2, W2])
    expect(accountNextTickAt(W2)).not.toBeNull()
  })
})
