import { describe, expect, it } from "vitest"

import { wallapopBrandFromProduct } from "../../lib/inventory/wallapop-brand"

describe("wallapopBrandFromProduct", () => {
  it("prefers the CRM brand field", () => {
    expect(
      wallapopBrandFromProduct({
        brand: "Nike",
        description: "Marca QUIRUMED\nColor Azul",
        typeAttributes: { brand: "Ignored" },
      }),
    ).toBe("Nike")
  })

  it("uses typeAttributes when the field is empty", () => {
    expect(
      wallapopBrandFromProduct({
        brand: null,
        typeAttributes: { Marca: "QUIRUMED" },
      }),
    ).toBe("QUIRUMED")
  })

  it("reads the Marca line from imported description specs", () => {
    expect(
      wallapopBrandFromProduct({
        brand: "  ",
        description:
          "Marca QUIRUMED\nColor Azul\nMaterial Aluminio\n\nQUIRUMED Andador con asiento",
      }),
    ).toBe("QUIRUMED")
  })

  it("reads a leading ALLCAPS token when there is no Marca line", () => {
    expect(
      wallapopBrandFromProduct({
        brand: null,
        description:
          "QUIRUMED Andador con asiento, Plegable, Aluminio, Color Azul",
      }),
    ).toBe("QUIRUMED")
  })

  it("returns null when nothing usable is present", () => {
    expect(
      wallapopBrandFromProduct({
        brand: null,
        description: "Andador plegable de aluminio",
        typeAttributes: {},
      }),
    ).toBeNull()
  })
})
