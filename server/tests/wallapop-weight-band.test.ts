import { describe, expect, it } from "vitest"

import {
  wallapopStandardWeightBandAriaName,
  wallapopStandardWeightBandFromCrm,
  wallapopStandardWeightBandLabel,
} from "../src/lib/wallapop-weight-band"

describe("wallapopStandardWeightBandLabel", () => {
  it("maps 0.5 kg to 0 a 1 kg", () => {
    expect(wallapopStandardWeightBandLabel(0.5)).toBe("0 a 1 kg")
  })

  it("maps 1.1 kg to 1 a 2 kg", () => {
    expect(wallapopStandardWeightBandLabel(1.1)).toBe("1 a 2 kg")
  })

  it("maps 7 kg to 5 a 10 kg", () => {
    expect(wallapopStandardWeightBandLabel(7)).toBe("5 a 10 kg")
  })

  it("keeps the upper bound of a band (no bump to the next)", () => {
    expect(wallapopStandardWeightBandLabel(1)).toBe("0 a 1 kg")
    expect(wallapopStandardWeightBandLabel(2)).toBe("1 a 2 kg")
    expect(wallapopStandardWeightBandLabel(5)).toBe("2 a 5 kg")
    expect(wallapopStandardWeightBandLabel(10)).toBe("5 a 10 kg")
    expect(wallapopStandardWeightBandLabel(20)).toBe("10 a 20 kg")
    expect(wallapopStandardWeightBandLabel(30)).toBe("20 a 30 kg")
  })

  it("returns null above 30 kg", () => {
    expect(wallapopStandardWeightBandLabel(30.01)).toBeNull()
  })
})

describe("wallapopStandardWeightBandFromCrm", () => {
  it("uses the CRM kg as-is for the Wallapop band", () => {
    expect(wallapopStandardWeightBandFromCrm(0)).toBe("0 a 1 kg")
    expect(wallapopStandardWeightBandFromCrm(0.5)).toBe("0 a 1 kg")
    expect(wallapopStandardWeightBandFromCrm(1.1)).toBe("1 a 2 kg")
    expect(wallapopStandardWeightBandFromCrm(2)).toBe("1 a 2 kg")
    expect(wallapopStandardWeightBandFromCrm(7)).toBe("5 a 10 kg")
    expect(wallapopStandardWeightBandFromCrm(7.5)).toBe("5 a 10 kg")
    expect(wallapopStandardWeightBandFromCrm(9.8)).toBe("5 a 10 kg")
    expect(wallapopStandardWeightBandFromCrm(10)).toBe("5 a 10 kg")
    expect(wallapopStandardWeightBandFromCrm(10.01)).toBe("10 a 20 kg")
    expect(wallapopStandardWeightBandFromCrm(30)).toBe("20 a 30 kg")
    expect(wallapopStandardWeightBandFromCrm(30.01)).toBeNull()
  })
})

describe("wallapopStandardWeightBandAriaName", () => {
  it("maps band needles to Delivery Option N", () => {
    expect(wallapopStandardWeightBandAriaName("0 a 1 kg")).toBe(
      "Delivery Option 0",
    )
    expect(wallapopStandardWeightBandAriaName("2 a 5 kg")).toBe(
      "Delivery Option 2",
    )
    expect(wallapopStandardWeightBandAriaName("20 a 30 kg")).toBe(
      "Delivery Option 5",
    )
    expect(wallapopStandardWeightBandAriaName("unknown")).toBeNull()
  })
})
