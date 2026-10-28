import { describe, expect, it } from "vitest"

import { duplicatePrice } from "../../lib/inventory/duplicate-price"

describe("duplicatePrice with the second account's ending (98)", () => {
  it("matches the client's examples", () => {
    expect(duplicatePrice(9.95, 98)).toBe(9.98)
    expect(duplicatePrice(19.95, 98)).toBe(19.98)
    expect(duplicatePrice(49.95, 98)).toBe(49.98)
  })

  it("never goes more than 3 cents above the original", () => {
    expect(duplicatePrice(289.99, 98)).toBe(289.98)
    expect(duplicatePrice(184.95, 98)).toBe(184.98)
    expect(duplicatePrice(10, 98)).toBe(9.98)
    expect(duplicatePrice(10.5, 98)).toBe(9.98)
    expect(duplicatePrice(10.97, 98)).toBe(10.98)
    expect(duplicatePrice(10.98, 98)).toBe(10.98)
  })

  it("survives float noise and tiny prices", () => {
    expect(duplicatePrice(0.1 + 0.2 + 54.65, 98)).toBe(54.98)
    expect(duplicatePrice(0.5, 98)).toBe(0.98)
  })

  it("uses 98 when no ending is given", () => {
    expect(duplicatePrice(19.95)).toBe(19.98)
  })
})

describe("duplicatePrice with another account's ending", () => {
  it("gives a third account (97) a price different from the second (98)", () => {
    expect(duplicatePrice(19.95, 97)).toBe(19.97)
    expect(duplicatePrice(289.99, 97)).toBe(289.97)
    expect(duplicatePrice(19.95, 97)).not.toBe(duplicatePrice(19.95, 98))
  })

  it("keeps the not-dearer rule: at most 3 cents up, otherwise the euro below", () => {
    expect(duplicatePrice(10, 97)).toBe(9.97)
    expect(duplicatePrice(9.95, 99)).toBe(8.99)
    expect(duplicatePrice(9.96, 99)).toBe(9.99)
  })

  it("falls back to 98 for an ending outside 0-99", () => {
    expect(duplicatePrice(19.95, 150)).toBe(19.98)
    expect(duplicatePrice(19.95, -1)).toBe(19.98)
  })
})
