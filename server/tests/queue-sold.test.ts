import { describe, expect, it } from "vitest"

import { listingBlocksManualQueue } from "../src/routes/product-listings"

const ITEM = "https://es.wallapop.com/item/cabecero-145"

describe("listingBlocksManualQueue", () => {
  it("lets a sold deactivated ad back into the queue and drops the old link", () => {
    expect(
      listingBlocksManualQueue("SOLD", {
        status: "DEACTIVATED",
        externalUrl: ITEM,
      }),
    ).toBe(false)
    expect(listingBlocksManualQueue("SOLD", null)).toBe(false)
  })

  it("keeps a live or in-flight ad off the manual queue", () => {
    expect(
      listingBlocksManualQueue("SOLD", { status: "ACTIVE", externalUrl: ITEM }),
    ).toBe(true)
    expect(
      listingBlocksManualQueue("ACTIVE", {
        status: "RESERVED",
        externalUrl: ITEM,
      }),
    ).toBe(true)
    expect(
      listingBlocksManualQueue("ACTIVE", { status: "POSTING", externalUrl: null }),
    ).toBe(true)
  })

  it("still refuses an unsold ad that still has a public link", () => {
    expect(
      listingBlocksManualQueue("ACTIVE", {
        status: "DEACTIVATED",
        externalUrl: ITEM,
      }),
    ).toBe(true)
    expect(
      listingBlocksManualQueue("ACTIVE", {
        status: "DEACTIVATED",
        externalUrl: null,
      }),
    ).toBe(false)
  })

  it("lets a MISSING listing back into the queue even with the saved /item/", () => {
    expect(
      listingBlocksManualQueue("ACTIVE", {
        status: "MISSING",
        externalUrl: ITEM,
      }),
    ).toBe(false)
  })
})
