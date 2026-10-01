import { describe, expect, it } from "vitest"

import {
  crmDescriptionMatchesForm,
  normalizePublishDescription,
} from "../src/lib/wallapop-description"

describe("crmDescriptionMatchesForm", () => {
  it("treats whitespace-only differences as the same text", () => {
    expect(normalizePublishDescription("  Hola  \r\n\nmundo  ")).toBe(
      "Hola\n\nmundo",
    )
    expect(
      crmDescriptionMatchesForm("Hola   mundo\n", "Hola mundo"),
    ).toBe(true)
  })

  it("rejects Wallapop AI rewrites", () => {
    expect(
      crmDescriptionMatchesForm(
        "Magnífica cafetera en perfecto estado, poco uso.",
        "Cafetera Cecotec, funciona bien, poco uso.",
      ),
    ).toBe(false)
  })

  it("passes when CRM description is empty", () => {
    expect(crmDescriptionMatchesForm("cualquier cosa", "  ")).toBe(true)
  })
})
