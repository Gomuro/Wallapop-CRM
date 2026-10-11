import { describe, expect, it } from "vitest"

import {
  isBrandRequiredForCategory,
  productMissingRequiredWallapopBrand,
  wallapopBrandFromProduct,
} from "../../lib/inventory/wallapop-brand"

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

describe("isBrandRequiredForCategory", () => {
  it("is false for Motor recambios leaves without a brand upload field", () => {
    const snapshot = JSON.parse(
      require("node:fs").readFileSync(
        require("node:path").join(
          __dirname,
          "../prisma/data/wallapop-upload-fields.json",
        ),
        "utf8",
      ),
    ) as {
      catalogs: Array<{ leafWallapopIds: number[]; fields: unknown[] }>
    }
    const motor = snapshot.catalogs.find((catalog) =>
      catalog.leafWallapopIds.includes(10334),
    )
    expect(motor).toBeDefined()
    expect(
      isBrandRequiredForCategory({ uploadFields: motor!.fields }),
    ).toBe(false)
  })

  it("is true only when upload schema marks brand required", () => {
    const attrs = {
      uploadFields: [
        {
          id: "brand",
          type: "combo_box",
          required: true,
          label: "Marca",
          min: 1,
          max: 1,
          options: [],
          source: null,
        },
      ],
    }
    expect(isBrandRequiredForCategory(attrs)).toBe(true)
    expect(
      productMissingRequiredWallapopBrand({
        categoryAttributes: attrs,
        brand: null,
        description: "Sin marca en texto",
      }),
    ).toBe(true)
    expect(
      productMissingRequiredWallapopBrand({
        categoryAttributes: attrs,
        brand: "Nike",
      }),
    ).toBe(false)
  })
})
