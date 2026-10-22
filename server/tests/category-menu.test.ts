import { describe, expect, it } from "vitest"

import {
  optionListHasLabel,
  parentMenuAdvanced,
} from "../src/lib/wallapop-publish/category-menu"

/** Open root on the springs upload, 2026-10-22. The wrong leaf is pinned first. */
const rootWithSuggestion = [
  "Suspensión y dirección",
  "Motos",
  "Motor y accesorios",
  "Moda y accesorios",
  "Otros",
]

const motorChildren = [
  'Sólo seleccionar "Motor y accesorios"',
  "GPS y electrónica",
  "Herramientas",
  "Recambios de coches y furgonetas",
  "Recambios de motos y cuatriciclos",
  "Otros",
]

describe("parentMenuAdvanced", () => {
  it("rejects a click that only closes the menu", () => {
    expect(
      parentMenuAdvanced(
        ["Suspensión y dirección", "Motor y accesorios"],
        [],
      ),
    ).toBe(false)
    expect(
      parentMenuAdvanced(
        ["Motor y accesorios", "Motos"],
        ["Motor y accesorios", "Motos"],
      ),
    ).toBe(false)
  })

  it("accepts the next non-empty list", () => {
    expect(
      parentMenuAdvanced(
        ["Suspensión y dirección", "Motor y accesorios"],
        ["Recambios de coches y furgonetas", "Otros"],
      ),
    ).toBe(true)
  })
})

describe("optionListHasLabel", () => {
  it("does not treat the pinned suggestion or the parent as the CRM leaf", () => {
    expect(optionListHasLabel(rootWithSuggestion, "Accesorios")).toBe(false)
    expect(optionListHasLabel(rootWithSuggestion, "Suspensión y dirección")).toBe(true)
    expect(optionListHasLabel(rootWithSuggestion, "Motor y accesorios")).toBe(true)
  })

  it("does not click Sólo seleccionar when the path continues", () => {
    expect(optionListHasLabel(motorChildren, "Motor y accesorios")).toBe(false)
    expect(
      optionListHasLabel(motorChildren, "Recambios de coches y furgonetas"),
    ).toBe(true)
  })
})
