import { describe, expect, it, vi } from "vitest"

import {
  normalizeWallapopEmail,
  syncWallapopIdentityOnActive,
  wallapopIdentityChanged,
} from "../src/lib/wallapop-account-identity"

describe("wallapop identity", () => {
  it("normalizes email case and space", () => {
    expect(normalizeWallapopEmail("  Ada@Wallapop.es ")).toBe("ada@wallapop.es")
  })

  it("does not treat a first login as a change", () => {
    expect(wallapopIdentityChanged(null, "a@x.com")).toBe(false)
    expect(wallapopIdentityChanged("  ", "a@x.com")).toBe(false)
  })

  it("ignores case when comparing", () => {
    expect(wallapopIdentityChanged("Ada@X.com", "ada@x.com")).toBe(false)
  })

  it("detects a different Wallapop email", () => {
    expect(wallapopIdentityChanged("old@x.com", "new@x.com")).toBe(true)
  })

  it("stores the first email without resetting listings", async () => {
    const update = vi.fn(async () => ({ id: "acc" }))
    const updateMany = vi.fn(async () => ({ count: 0 }))
    const prisma = {
      account: {
        findFirst: async () => ({ id: "acc", wallapopEmail: null }),
        update,
      },
      productListing: { updateMany },
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    }

    const result = await syncWallapopIdentityOnActive(prisma as never, "Ada@X.com")
    expect(result).toEqual({ listingsReset: false })
    expect(update).toHaveBeenCalledWith({
      where: { id: "acc" },
      data: { wallapopEmail: "ada@x.com" },
    })
    expect(updateMany).not.toHaveBeenCalled()
  })

  it("resets listings when the Wallapop email changes", async () => {
    const update = vi.fn(async () => ({ id: "acc" }))
    const updateMany = vi.fn(async () => ({ count: 2 }))
    const prisma = {
      account: {
        findFirst: async () => ({ id: "acc", wallapopEmail: "old@x.com" }),
        update,
      },
      productListing: { updateMany },
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    }

    const result = await syncWallapopIdentityOnActive(prisma as never, "new@x.com")
    expect(result).toEqual({ listingsReset: true })
    expect(updateMany).toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith({
      where: { id: "acc" },
      data: { wallapopEmail: "new@x.com", autopostEnabled: false },
    })
  })
})
