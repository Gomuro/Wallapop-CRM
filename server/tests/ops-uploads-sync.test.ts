import { describe, expect, it } from "vitest"

import {
  isSafeStorageKey,
  uniqueStorageKeys,
} from "../../lib/uploads/config"

describe("ops upload keys", () => {
  it("accepts nanoid keys with an image extension", () => {
    expect(isSafeStorageKey("ayhHTtb7Y1DgyNuT.webp")).toBe(true)
    expect(isSafeStorageKey("../etc/passwd")).toBe(false)
    expect(isSafeStorageKey("a/b.webp")).toBe(false)
  })

  it("dedupes and drops unsafe keys", () => {
    expect(
      uniqueStorageKeys(["a.webp", "a.webp", "../x", "b.jpg"]),
    ).toEqual(["a.webp", "b.jpg"])
  })
})
