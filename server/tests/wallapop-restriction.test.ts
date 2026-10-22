import { describe, expect, it, vi } from "vitest"

import {
  countUnseenStreak,
  LoginSignalError,
  noteLoginFailure,
  recordUnseenMisses,
  REJECTED_CREDENTIALS_PATTERN,
  restrictionBlockMessage,
  suspectRestriction,
  UNSEEN_STREAK_LIMIT,
  UNSEEN_WINDOW_MS,
  type StreakListing,
} from "../src/lib/wallapop-restriction"

const NOW = new Date("2026-10-22T12:00:00Z")
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000)

function unseen(postedMinutesAgo: number, goneAfterMinutes = 10): StreakListing {
  const postedAt = minutesAgo(postedMinutesAgo)
  return {
    status: "MISSING",
    lastPostedAt: postedAt,
    missingAt: new Date(postedAt.getTime() + goneAfterMinutes * 60_000),
  }
}

const survivor = (postedMinutesAgo: number): StreakListing => ({
  status: "ACTIVE",
  lastPostedAt: minutesAgo(postedMinutesAgo),
  missingAt: null,
})

describe("countUnseenStreak", () => {
  it("counts consecutive ads that vanished inside the window", () => {
    const rows = [unseen(30), unseen(90), unseen(150)]
    expect(countUnseenStreak(rows, NOW)).toBe(3)
  })

  it("resets at an ad that stayed ACTIVE for the whole window", () => {
    const rows = [unseen(30), survivor(120), unseen(200), unseen(300)]
    expect(countUnseenStreak(rows, NOW)).toBe(1)
  })

  it("ignores ads a CRM worker removed (no missingAt)", () => {
    const removedByCrm: StreakListing = {
      status: "MISSING",
      lastPostedAt: minutesAgo(40),
      missingAt: null,
    }
    expect(countUnseenStreak([removedByCrm, unseen(90)], NOW)).toBe(1)
  })

  it("does not count or reset on ads that are still young", () => {
    const young = survivor(10)
    expect(countUnseenStreak([young, unseen(90), unseen(150)], NOW)).toBe(2)
  })

  it("treats an ad that vanished after the window as seen", () => {
    const lateGone = unseen(300, UNSEEN_WINDOW_MS / 60_000 + 5)
    expect(countUnseenStreak([unseen(30), lateGone, unseen(400)], NOW)).toBe(1)
  })
})

function fakeDb() {
  const accountUpdateMany = vi.fn(async () => ({ count: 1 }))
  const listingUpdateMany = vi.fn(async () => ({ count: 1 }))
  const findMany = vi.fn(async () => [] as StreakListing[])
  const findUnique = vi.fn(async () => ({ wallapopEmail: "ada@x.com" }))
  const db = {
    account: { updateMany: accountUpdateMany, findUnique },
    productListing: { updateMany: listingUpdateMany, findMany },
  }
  return { db: db as never, accountUpdateMany, listingUpdateMany, findMany, findUnique }
}

describe("suspectRestriction", () => {
  it("keeps the first reason and switches autopost off", async () => {
    const { db, accountUpdateMany } = fakeDb()
    await suspectRestriction(db, "acc", "FORCED_SIGNOUT", NOW)
    expect(accountUpdateMany).toHaveBeenNthCalledWith(1, {
      where: { id: "acc", restrictionSuspectedAt: null },
      data: expect.objectContaining({ restrictionSuspectedAt: NOW }),
    })
    expect(accountUpdateMany).toHaveBeenNthCalledWith(2, {
      where: { id: "acc" },
      data: { autopostEnabled: false },
    })
  })
})

describe("recordUnseenMisses", () => {
  const rows = [
    { id: "a", accountId: "acc", status: "ACTIVE" },
    { id: "b", accountId: "acc", status: "RESERVED" },
  ]

  it("stamps only ACTIVE ads and skips them while a CRM worker runs", async () => {
    const idle = fakeDb()
    await recordUnseenMisses(idle.db, rows, async () => false, NOW)
    expect(idle.listingUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["a"] } },
      data: { missingAt: NOW },
    })

    const busy = fakeDb()
    await recordUnseenMisses(busy.db, rows, async () => true, NOW)
    expect(busy.listingUpdateMany).not.toHaveBeenCalled()
  })

  it("suspects the account once the streak hits the limit", async () => {
    const { db, findMany, accountUpdateMany } = fakeDb()
    findMany.mockResolvedValue(
      Array.from({ length: UNSEEN_STREAK_LIMIT }, (_, i) => unseen(30 + i * 60)),
    )
    await recordUnseenMisses(db, rows, async () => false, NOW)
    expect(accountUpdateMany).toHaveBeenCalled()
  })

  it("stays quiet below the limit", async () => {
    const { db, findMany, accountUpdateMany } = fakeDb()
    findMany.mockResolvedValue([unseen(30)])
    await recordUnseenMisses(db, rows, async () => false, NOW)
    expect(accountUpdateMany).not.toHaveBeenCalled()
  })
})

describe("noteLoginFailure", () => {
  it("always flags reCAPTCHA", async () => {
    const { db, accountUpdateMany } = fakeDb()
    const error = new LoginSignalError("LOGIN_RECAPTCHA", "captcha")
    await noteLoginFailure(db, "acc", "new@x.com", error)
    expect(accountUpdateMany).toHaveBeenCalled()
  })

  it("flags a rejected password only for the email that worked before", async () => {
    const error = new LoginSignalError("LOGIN_REJECTED", "no")
    const known = fakeDb()
    await noteLoginFailure(known.db, "acc", "ada@x.com", error)
    expect(known.accountUpdateMany).toHaveBeenCalled()

    const typo = fakeDb()
    await noteLoginFailure(typo.db, "acc", "other@x.com", error)
    expect(typo.accountUpdateMany).not.toHaveBeenCalled()
  })

  it("ignores ordinary errors", async () => {
    const { db, accountUpdateMany } = fakeDb()
    await noteLoginFailure(db, "acc", "ada@x.com", new Error("timeout"))
    expect(accountUpdateMany).not.toHaveBeenCalled()
  })
})

describe("REJECTED_CREDENTIALS_PATTERN", () => {
  it("matches the real Wallapop login error", () => {
    expect(
      REJECTED_CREDENTIALS_PATTERN.test(
        "El email y/o la contraseña son incorrectos. Revísalos y vuelve a intentarlo.",
      ),
    ).toBe(true)
  })

  it("still matches the shorter wording and ignores other text", () => {
    expect(REJECTED_CREDENTIALS_PATTERN.test("email y/o contraseña incorrectos")).toBe(true)
    expect(REJECTED_CREDENTIALS_PATTERN.test("Wallapop muestra reCAPTCHA")).toBe(false)
  })
})

describe("restrictionBlockMessage", () => {
  it("names the reason", () => {
    expect(restrictionBlockMessage("motivo X")).toContain("motivo X")
  })
})
