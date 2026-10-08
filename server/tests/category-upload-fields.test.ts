import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  extraUploadFields,
  fingerprintUploadFields,
  parseUploadComponents,
  validateExtraUploadFields,
} from "../../lib/inventory/category-upload-fields"

const fixture = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../prisma/data/upload-components-probe-24250.json"),
    "utf8",
  ),
) as unknown

describe("parseUploadComponents", () => {
  it("reads the 24250 Armarios payload", () => {
    const fields = parseUploadComponents(fixture)
    expect(fields.map((field) => field.id)).toEqual([
      "suggested_data_banner",
      "photo",
      "brand",
      "color",
      "material",
      "title",
      "description",
      "condition",
      "price_amount",
      "measures",
      "lock_stocks",
    ])
    const extra = extraUploadFields(fields)
    expect(extra.map((field) => field.id)).toEqual(["brand", "color", "material"])
    const color = extra.find((field) => field.id === "color")
    expect(color).toMatchObject({
      type: "select_box",
      required: true,
      label: "Color",
      min: 1,
      max: 2,
    })
    expect(color?.options.some((option) => option.id === "white")).toBe(true)
    const material = extra.find((field) => field.id === "material")
    expect(material).toMatchObject({
      type: "select_box",
      required: true,
      label: "Material",
      min: 1,
      max: 3,
    })
    expect(material?.options.some((option) => option.id === "wood")).toBe(true)
    const brand = fields.find((field) => field.id === "brand")
    expect(brand?.source).toContain("category_leaf_id=24250")
    expect(brand?.required).toBe(false)
  })

  it("fingerprints identical schemas the same way", () => {
    const fields = parseUploadComponents(fixture)
    expect(fingerprintUploadFields(fields)).toBe(
      fingerprintUploadFields(parseUploadComponents(fixture)),
    )
  })
})

describe("validateExtraUploadFields", () => {
  it("requires color and material on 24250", () => {
    const extra = extraUploadFields(parseUploadComponents(fixture))
    expect(validateExtraUploadFields(extra, {})).toEqual({
      color: "Elige Color.",
      material: "Elige Material.",
    })
    expect(
      validateExtraUploadFields(extra, {
        color: ["white"],
        material: ["wood"],
      }),
    ).toEqual({})
  })
})
