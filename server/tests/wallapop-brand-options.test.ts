import { describe, expect, it } from "vitest"

import {
  fingerprintBrandPage,
  parseBrandOptionsPayload,
} from "../prisma/wallapop-brand-options"

describe("parseBrandOptionsPayload", () => {
  it("reads results and the next page token", () => {
    const parsed = parseBrandOptionsPayload({
      token: "100",
      results: [
        { id: "Nike", title: "Nike" },
        { id: "Adidas", title: "Adidas" },
      ],
    })
    expect(parsed.results).toEqual([
      { id: "Nike", title: "Nike" },
      { id: "Adidas", title: "Adidas" },
    ])
    expect(parsed.nextToken).toBe("100")
  })

  it("stops paging when the page is empty", () => {
    expect(
      parseBrandOptionsPayload({ token: "100", results: [] }).nextToken,
    ).toBeNull()
  })
})

describe("fingerprintBrandPage", () => {
  it("uses the first ids so identical catalogs collapse", () => {
    expect(
      fingerprintBrandPage([
        { id: "Nike", title: "Nike" },
        { id: "Adidas", title: "Adidas" },
      ]),
    ).toBe("Nike|Adidas")
  })
})
