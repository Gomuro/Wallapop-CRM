import { afterEach, describe, expect, it } from "vitest"

import { generateVariantText, setVariantModelForTests } from "../src/lib/listing-variant/generate"
import { factNumbers, variantProblems } from "../src/lib/listing-variant/validate"
import { variantBasis } from "../src/lib/listing-variant/store"
import { liveText } from "../src/lib/wallapop-already-live"

const SOURCE = {
  title: "Caja almacenamiento 1450L Caseta",
  description:
    "Caja de almacenamiento de resina Duramax de 1450 litros. Medidas 202x122x180 cm. Nueva en caja, ideal para jardín.",
  brand: "Duramax",
}

const GOOD = {
  title: "Arcón de jardín Duramax 1450 L",
  description:
    "Arcón Duramax de resina con capacidad de 1450 litros, a estrenar y en su caja. Mide 202x122x180 cm, perfecto para guardar cosas del jardín.",
}

afterEach(() => setVariantModelForTests(null))

describe("factNumbers", () => {
  it("normalises decimal commas and splits dimensions", () => {
    expect([...factNumbers("1,2 x 2,40m y 202x122x180")]).toEqual(["1.2", "2.4", "202", "122", "180"])
  })
})

describe("variantProblems", () => {
  it("accepts a rewrite that keeps every fact", () => {
    expect(variantProblems(SOURCE, GOOD)).toEqual([])
  })

  it("rejects a title over 50 characters", () => {
    const long = { ...GOOD, title: "Arcón de jardín Duramax 1450 L de resina, nuevo en caja" }
    expect(variantProblems(SOURCE, long).join(" ")).toMatch(/máximo 50/)
  })

  it("rejects a lost dimension and an invented number", () => {
    const lost = { ...GOOD, description: GOOD.description.replace("202x122x180", "202x122x190") }
    const problems = variantProblems(SOURCE, lost).join(" ")
    expect(problems).toMatch(/Faltan cifras del original: 180/)
    expect(problems).toMatch(/no están en el original: 190/)
  })

  it("rejects the original wording and a missing brand", () => {
    expect(variantProblems(SOURCE, { title: SOURCE.title, description: SOURCE.description }).join(" "))
      .toMatch(/igual al original.*igual a la original/)
    const noBrand = {
      title: "Arcón de jardín 1450 L",
      description: GOOD.description.replace("Duramax ", ""),
    }
    expect(variantProblems(SOURCE, noBrand).join(" ")).toMatch(/Falta la marca Duramax/)
  })
})

describe("generateVariantText", () => {
  it("retries with the validator's complaints and returns the first good rewrite", async () => {
    const prompts: string[] = []
    const replies = [{ title: SOURCE.title, description: SOURCE.description }, GOOD]
    setVariantModelForTests(async (_system, user) => {
      prompts.push(user)
      return replies.shift() ?? GOOD
    })
    const result = await generateVariantText(SOURCE)
    expect(result).toMatchObject({ ok: true, attempts: 2, text: GOOD })
    expect(prompts[1]).toMatch(/Tu intento anterior no sirvió/)
  })

  it("gives up after three bad rewrites and never returns the original", async () => {
    setVariantModelForTests(async () => ({ title: SOURCE.title, description: SOURCE.description }))
    const result = await generateVariantText(SOURCE)
    expect(result.ok).toBe(false)
    expect(result.attempts).toBe(3)
  })

  it("stops at once when the model is unreachable", async () => {
    let calls = 0
    setVariantModelForTests(async () => {
      calls += 1
      throw new Error("Groq HTTP 503")
    })
    const result = await generateVariantText(SOURCE)
    expect(result).toMatchObject({ ok: false, attempts: 1 })
    expect(calls).toBe(1)
  })
})

describe("liveText", () => {
  const product = { title: SOURCE.title, price: { toString: () => "184.95" } }

  it("matches a duplicate on the public profile by its own title and ,98 price", () => {
    expect(
      liveText({ variantTitle: GOOD.title, variantPrice: { toString: () => "184.98" }, product }),
    ).toEqual({ title: GOOD.title, price: 184.98 })
  })

  it("matches an original listing by the product", () => {
    expect(liveText({ variantTitle: null, variantPrice: null, product })).toEqual({
      title: SOURCE.title,
      price: 184.95,
    })
  })
})

describe("variantBasis", () => {
  it("changes with the text and the brand, not with the price", () => {
    const base = variantBasis(SOURCE)
    expect(variantBasis({ ...SOURCE })).toBe(base)
    expect(variantBasis({ ...SOURCE, brand: "Keter" })).not.toBe(base)
    expect(variantBasis({ ...SOURCE, title: `${SOURCE.title}.` })).not.toBe(base)
  })
})
