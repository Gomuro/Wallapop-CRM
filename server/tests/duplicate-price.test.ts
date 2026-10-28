import { describe, expect, it } from "vitest"

import { duplicatePrice } from "../../lib/inventory/duplicate-price"

describe("duplicatePrice", () => {
  it("matches the client's examples", () => {
    expect(duplicatePrice(9.95)).toBe(9.98)
    expect(duplicatePrice(19.95)).toBe(19.98)
    expect(duplicatePrice(49.95)).toBe(49.98)
  })

  it("never goes more than 3 cents above the original", () => {
    expect(duplicatePrice(289.99)).toBe(289.98)
    expect(duplicatePrice(184.95)).toBe(184.98)
    expect(duplicatePrice(10)).toBe(9.98)
    expect(duplicatePrice(10.5)).toBe(9.98)
    expect(duplicatePrice(10.97)).toBe(10.98)
    expect(duplicatePrice(10.98)).toBe(10.98)
  })

  it("survives float noise and tiny prices", () => {
    expect(duplicatePrice(0.1 + 0.2 + 54.65)).toBe(54.98)
    expect(duplicatePrice(0.5)).toBe(0.98)
  })
})
