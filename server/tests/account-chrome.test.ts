import { describe, expect, it } from "vitest"

import { chromePlaceAt } from "../../lib/accounts/chrome-place"
import { assignChromePlaces, nextChromeSlot } from "../src/lib/account-chrome"

describe("nextChromeSlot", () => {
  it("starts at 0 and does not reuse a freed slot", () => {
    expect(nextChromeSlot([])).toBe(0)
    expect(nextChromeSlot([0])).toBe(1)
    expect(nextChromeSlot([0, 2])).toBe(3)
  })
})

describe("assignChromePlaces", () => {
  it("keeps each account on its own port after another slot is gone", () => {
    const places = assignChromePlaces([
      { id: "second", chromeSlot: 1 },
      { id: "third", chromeSlot: 2 },
    ])
    expect(places.get("second")).toEqual({
      port: 9232,
      profileName: "ChromeCDP-9232",
    })
    expect(places.get("third")?.port).toBe(9242)
    expect(chromePlaceAt(0).profileName).toBe("ChromeCDP-Persistent")
  })
})
