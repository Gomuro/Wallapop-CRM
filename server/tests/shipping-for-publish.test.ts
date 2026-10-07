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
  it("requires peso only; dimensiones are optional", () => {
    expect(missingShippingPublishFields({})).toEqual(["weightKg"])
    expect(isShippingPublishReady({})).toBe(false)

    const missingWeight = validateShippingForPublish({
      weightKg: null,
    })
    expect(missingWeight).toEqual({
      ok: false,
      code: SHIPPING_NOT_READY_CODE,
      message: SHIPPING_NOT_READY_MESSAGE,
    })

    expect(validateShippingForPublish({ weightKg: 1.2 })).toEqual({
      ok: true,
    })
  })

  it("rejects zero or non-finite peso", () => {
    expect(isShippingPublishReady({ weightKg: 0 })).toBe(false)
    expect(isShippingPublishReady({ weightKg: Number.NaN })).toBe(false)
  })

  it("still requires peso when envío was stored off", () => {
    expect(
      isShippingPublishReady({ weightKg: null, shippingEnabled: false }),
    ).toBe(false)
    expect(
      validateShippingForPublish({ weightKg: null, shippingEnabled: false }),
    ).toEqual({
      ok: false,
      code: SHIPPING_NOT_READY_CODE,
      message: SHIPPING_NOT_READY_MESSAGE,
    })
    expect(
      missingShippingPublishFields({ weightKg: null, shippingEnabled: false }),
    ).toEqual(["weightKg"])
  })
})

describe("showShippingIncompleteBadge", () => {
  it("shows on READY_TO_POST without peso", () => {
    expect(SHIPPING_INCOMPLETE_BADGE).toBe("Falta peso")
    expect(
      showShippingIncompleteBadge({
        status: "ACTIVE",
        listing: { status: "READY_TO_POST", externalUrl: null },
        shippingPublishReady: false,
      }),
    ).toBe(true)
  })

  it("shows on En Wallapop when peso is missing", () => {
    expect(
      showShippingIncompleteBadge({
        status: "ACTIVE",
        listing: { status: "ACTIVE", externalUrl: "https://es.wallapop.com/item/x" },
        shippingPublishReady: false,
      }),
    ).toBe(true)
  })

  it("hides when peso is set, warehouse inactive, or posting", () => {
    expect(
      showShippingIncompleteBadge({
        status: "ACTIVE",
        listing: { status: "READY_TO_POST" },
        shippingPublishReady: true,
      }),
    ).toBe(false)
    expect(
      showShippingIncompleteBadge({
        status: "SOLD",
        listing: { status: "ACTIVE" },
        shippingPublishReady: false,
      }),
    ).toBe(false)
    expect(
      showShippingIncompleteBadge({
        status: "ACTIVE",
        listing: { status: "POSTING" },
        shippingPublishReady: false,
      }),
    ).toBe(false)
  })
})
