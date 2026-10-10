import { describe, expect, it } from "vitest"

import { listingIndicatorShort, listingStatusLabel } from "../../lib/inventory/format"
import {
  computeListingActive,
  isLiveOnWallapopStatus,
} from "../../lib/inventory/listing-active"
import { listingStatusSchema } from "../../lib/validations/listing"

const reservedListing = {
  id: "l1",
  accountId: "a1",
  externalUrl: "https://es.wallapop.com/item/x",
  status: "RESERVED" as const,
  lastPostedAt: null,
  shippingEnabled: true,
}

describe("ListingStatus.RESERVED", () => {
  it("is writable via PUT schema", () => {
    expect(listingStatusSchema.parse("RESERVED")).toBe("RESERVED")
  })

  it("is live on Wallapop and listingActive", () => {
    expect(isLiveOnWallapopStatus("RESERVED")).toBe(true)
    expect(isLiveOnWallapopStatus("ACTIVE")).toBe(true)
    expect(isLiveOnWallapopStatus("DEACTIVATED")).toBe(false)
    expect(computeListingActive(reservedListing)).toBe(true)
  })

  it("is not En Wallapop without a public /item/ URL", () => {
    expect(
      computeListingActive({ ...reservedListing, status: "ACTIVE", externalUrl: null }),
    ).toBe(false)
    expect(
      computeListingActive({
        ...reservedListing,
        status: "ACTIVE",
        externalUrl: "https://es.wallapop.com/app/catalog/upload/consumer-goods",
      }),
    ).toBe(false)
    expect(
      listingIndicatorShort(
        { ...reservedListing, status: "ACTIVE", externalUrl: null },
        false,
      ),
    ).toBe("Sin enlace")
  })

  it("badge says Reservado, not En Wallapop", () => {
    expect(listingStatusLabel("RESERVED")).toBe("Reservado")
    expect(listingIndicatorShort(reservedListing, true)).toBe("Reservado")
    expect(
      listingIndicatorShort(
        { ...reservedListing, status: "ACTIVE" },
        true,
      ),
    ).toBe("En Wallapop")
  })
})
