import { describe, expect, it } from "vitest"

import { siblingQueueOffWhere } from "../src/lib/product-sold"

describe("siblingQueueOffWhere", () => {
  it("takes other accounts off the queue and leaves the seller", () => {
    expect(siblingQueueOffWhere("product", "seller")).toEqual({
      productId: "product",
      status: { in: ["READY_TO_POST", "PREPARING", "POSTING"] },
      accountId: { not: "seller" },
    })
  })

  it("clears every queued row when the seller was not recorded", () => {
    expect(siblingQueueOffWhere("product", null)).toEqual({
      productId: "product",
      status: { in: ["READY_TO_POST", "PREPARING", "POSTING"] },
    })
  })
})
