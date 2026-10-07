import { describe, expect, it } from "vitest"

import { targetCategoryId, wallapopIdToCategoryId } from "../ops/remap"

describe("ops remap", () => {
  it("maps wallapop_id onto the target category cuid", () => {
    const map = wallapopIdToCategoryId([
      { id: "local-camas", wallapopId: 10257 },
    ])
    expect(targetCategoryId(10257, map)).toBe("local-camas")
    expect(targetCategoryId(1, map)).toBeNull()
    expect(targetCategoryId(null, map)).toBeNull()
  })
})
