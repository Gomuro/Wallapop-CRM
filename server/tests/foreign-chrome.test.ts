import { describe, expect, it } from "vitest"

import {
  isForeignAccountChrome,
  readActionAccountId,
} from "../src/lib/foreign-chrome"

describe("foreign chrome", () => {
  it("lets the first account through when the button names it", () => {
    expect(
      isForeignAccountChrome({ accountId: "norte", defaultAccountId: "norte" }),
    ).toBe(false)
  })

  it("stops a second account before any browser call", () => {
    expect(
      isForeignAccountChrome({ accountId: "sur", defaultAccountId: "norte" }),
    ).toBe(true)
  })

  it("keeps the old call with no accountId on the first Chrome", () => {
    expect(
      isForeignAccountChrome({
        accountId: undefined,
        defaultAccountId: "norte",
      }),
    ).toBe(false)
    expect(readActionAccountId({})).toBeUndefined()
    expect(readActionAccountId({ accountId: "  sur  " })).toBe("sur")
  })
})
