import { describe, expect, it } from "vitest"

import {
  isShippingPublishReady,
  missingShippingPublishFields,
  SHIPPING_INCOMPLETE_BADGE,
  SHIPPING_NOT_READY_CODE,
  SHIPPING_NOT_READY_MESSAGE,
  showShippingIncompleteBadge,
  validateShippingForPublish,
} from "../../lib/inventory/shipping-for-publish"

describe("validateShippingForPublish", () => {
  it("requires peso and three dimensions", () => {
    expect(missingShippingPublishFields({})).toEqual([
      "weightKg",
      "widthCm",
      "lengthCm",
      "heightCm",
    ])
    expect(isShippingPublishReady({})).toBe(false)

    const missingWeight = validateShippingForPublish({
      weightKg: null,
      widthCm: 10,
      lengthCm: 10,
      heightCm: 10,
    })
    expect(missingWeight).toEqual({
      ok: false,
      code: SHIPPING_NOT_READY_CODE,
      message: SHIPPING_NOT_READY_MESSAGE,
    })

    expect(
      validateShippingForPublish({
        weightKg: 1.2,
        widthCm: 10,
        lengthCm: 20,
        heightCm: 15,
      }),
    ).toEqual({ ok: true })
  })

  it("rejects zero or non-finite measures", () => {
    expect(
      isShippingPublishReady({
        weightKg: 0,
        widthCm: 10,
        lengthCm: 10,
        heightCm: 10,
      }),
    ).toBe(false)
    expect(
      isShippingPublishReady({
        weightKg: 1,
        widthCm: Number.NaN,
        lengthCm: 10,
        heightCm: 10,
      }),
    ).toBe(false)
  })
})

describe("showShippingIncompleteBadge", () => {
  it("shows on READY_TO_POST without shipping data", () => {
    expect(SHIPPING_INCOMPLETE_BADGE).toBe("Faltan peso o medidas")
    expect(
      showShippingIncompleteBadge({
        status: "ACTIVE",
        listing: { status: "READY_TO_POST", externalUrl: null },
        shippingPublishReady: false,
      }),
    ).toBe(true)
  })

  it("hides when already on Wallapop or data is complete", () => {
    expect(
      showShippingIncompleteBadge({
        status: "ACTIVE",
        listing: { status: "ACTIVE", externalUrl: "https://es.wallapop.com/item/x" },
        shippingPublishReady: false,
      }),
    ).toBe(false)
    expect(
      showShippingIncompleteBadge({
        status: "ACTIVE",
        listing: { status: "READY_TO_POST" },
        shippingPublishReady: true,
      }),
    ).toBe(false)
  })
})
