import { describe, expect, it } from "vitest"

import { chromePlaceAt } from "../../lib/accounts/chrome-place"
import { readActionAccountId } from "../src/lib/foreign-chrome"

describe("chrome place", () => {
  it("keeps the first account on 9222 and ChromeCDP-Persistent", () => {
    expect(chromePlaceAt(0)).toEqual({
      port: 9222,
      profileName: "ChromeCDP-Persistent",
    })
  })

  it("gives the next accounts 9232 and 9242 with their own folder", () => {
    expect(chromePlaceAt(1)).toEqual({
      port: 9232,
      profileName: "ChromeCDP-9232",
    })
    expect(chromePlaceAt(2)).toEqual({
      port: 9242,
      profileName: "ChromeCDP-9242",
    })
  })

  it("reads an account id from the button body", () => {
    expect(readActionAccountId({})).toBeUndefined()
    expect(readActionAccountId({ accountId: "  sur  " })).toBe("sur")
  })
})
