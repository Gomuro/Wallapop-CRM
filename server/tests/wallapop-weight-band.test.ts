import { describe, expect, it } from "vitest"

import {
  PACKAGING_BUFFER_KG,
  wallapopEffectiveWeightKg,
  wallapopStandardWeightBandAriaName,
  wallapopStandardWeightBandFromCrm,
  wallapopStandardWeightBandLabel,
} from "../src/lib/wallapop-weight-band"

describe("wallapopStandardWeightBandLabel", () => {
  it("maps 0.5 kg effective to 0 a 1 kg", () => {
    expect(wallapopStandardWeightBandLabel(0.5)).toBe("0 a 1 kg")
  })

  it("maps 1.1 kg effective to 1 a 2 kg", () => {
    expect(wallapopStandardWeightBandLabel(1.1)).toBe("1 a 2 kg")
  })

  it("maps 7 kg effective to 5 a 10 kg", () => {
    expect(wallapopStandardWeightBandLabel(7)).toBe("5 a 10 kg")
  })

  it("includes the upper bound of a band", () => {
    expect(wallapopStandardWeightBandLabel(1)).toBe("0 a 1 kg")
    expect(wallapopStandardWeightBandLabel(10)).toBe("5 a 10 kg")
    expect(wallapopStandardWeightBandLabel(30)).toBe("20 a 30 kg")
  })

  it("returns null above 30 kg", () => {
    expect(wallapopStandardWeightBandLabel(30.01)).toBeNull()
  })
})

describe("wallapopStandardWeightBandFromCrm", () => {
  it("adds packaging buffer before choosing the band", () => {
    expect(PACKAGING_BUFFER_KG).toBe(0.25)
    expect(wallapopEffectiveWeightKg(0)).toBe(0.25)
    expect(wallapopStandardWeightBandFromCrm(0)).toBe("0 a 1 kg")
    expect(wallapopStandardWeightBandFromCrm(0.5)).toBe("0 a 1 kg")
    expect(wallapopStandardWeightBandFromCrm(1.1)).toBe("1 a 2 kg")
    expect(wallapopStandardWeightBandFromCrm(7)).toBe("5 a 10 kg")
    expect(wallapopStandardWeightBandFromCrm(7.5)).toBe("5 a 10 kg")
    expect(wallapopStandardWeightBandFromCrm(9.8)).toBe("10 a 20 kg")
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
