import { describe, expect, it } from "vitest"

import { accountGlanceLabel } from "../../lib/inventory/format"
import {
  PACKAGING_BUFFER_KG,
  STANDARD_WEIGHT_BANDS,
  crmKgForStandardBand,
  normalizeWeightBandLabel,
  pickCategoryWeightBand,
  publishWeightStopMessage,
  wallapopEffectiveWeightKg,
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
    expect(wallapopStandardWeightBandFromCrm(30)).toBe("20 a 30 kg")
    expect(wallapopStandardWeightBandFromCrm(29.9)).toBe("20 a 30 kg")
    expect(wallapopStandardWeightBandFromCrm(30.01)).toBeNull()
  })
})

describe("crmKgForStandardBand", () => {
  it("lands each Estándar tramo after the packaging buffer", () => {
    for (const band of STANDARD_WEIGHT_BANDS) {
      const kg = crmKgForStandardBand(band.maxKg)
      expect(wallapopStandardWeightBandFromCrm(kg)).toBe(band.needle)
    }
  })
})

describe("normalizeWeightBandLabel", () => {
  it("strips the bidi marks Wallapop puts around the kilograms", () => {
    expect(normalizeWeightBandLabel("‪10‬ a ‪20‬ kg")).toBe("10 a 20 kg")
    expect(normalizeWeightBandLabel("20 a 30 kg")).toBe("20 a 30 kg")
  })
})

describe("pickCategoryWeightBand", () => {
  const upTo20 = ["0 a 1 kg", "1 a 2 kg", "2 a 5 kg", "5 a 10 kg", "10 a 20 kg"]

  it("uses the category band that contains the weight", () => {
    expect(pickCategoryWeightBand(0.5, upTo20)?.needle).toBe("0 a 1 kg")
    expect(pickCategoryWeightBand(15, upTo20)).toMatchObject({
      needle: "10 a 20 kg",
      clamped: false,
    })
  })

  it("clamps above the last category band and never invents 20 a 30 kg", () => {
    expect(pickCategoryWeightBand(25, upTo20)).toEqual({
      needle: "10 a 20 kg",
      clamped: true,
      wanted: "20 a 30 kg",
    })
    expect(pickCategoryWeightBand(40, upTo20)).toMatchObject({
      needle: "10 a 20 kg",
      clamped: true,
      wanted: null,
    })
  })

  it("returns null when the category lists no bands", () => {
    expect(pickCategoryWeightBand(25, [])).toBeNull()
  })
})

describe("publishWeightStopMessage", () => {
  it("names the band the category does not list", () => {
    expect(
      publishWeightStopMessage({
        wanted: "20 a 30 kg",
        selected: "10 a 20 kg",
        reason: "no_package_size",
      }),
    ).toBe(
      "Peso 20 a 30 kg: ese tramo no está en la categoría. Tras elegir 10 a 20 kg no aparecieron Estándar ni Voluminoso.",
    )
  })
})

describe("accountGlanceLabel", () => {
  const row = {
    accountId: "a",
    accountName: "Wallapop 2",
    isDefault: false,
    externalUrl: null,
  }

  it("shows the saved reason next to Error", () => {
    expect(
      accountGlanceLabel({
        ...row,
        status: "FAILED",
        lastPublishError: "Peso 20 a 30 kg: ese tramo no está en la categoría.",
      }),
    ).toBe("Error · Peso 20 a 30 kg: ese tramo no está en la categoría.")
  })

  it("stays Error when no reason was saved", () => {
    expect(accountGlanceLabel({ ...row, status: "FAILED", lastPublishError: null })).toBe(
      "Error",
    )
  })
})
