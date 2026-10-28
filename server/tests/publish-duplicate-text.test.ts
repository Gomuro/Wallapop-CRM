import type { Express } from "express"
import request from "supertest"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const browser = vi.hoisted(() => ({
  calls: [] as Array<{ title: string; description: string; price: number }>,
}))

vi.mock("../src/lib/wallapop-publish", async (original) => ({
  ...(await original<typeof import("../src/lib/wallapop-publish")>()),
  publishWallapopInBrowser: vi.fn(async (input: { title: string; description: string; price: number }) => {
    browser.calls.push({ title: input.title, description: input.description, price: input.price })
    return { dryRun: true, step: "dry-run", externalUrl: null }
  }),
}))

import { createApp } from "../src/app"
import { nextChromeSlot } from "../src/lib/account-chrome"
import { getPrisma } from "../src/lib/db"
import { setVariantModelForTests } from "../src/lib/listing-variant/generate"
import type { PublishReady } from "../src/routes/product-publish-prepare"
import { executeLivePublish } from "../src/routes/product-publish-run"
import { loadProductCard } from "../src/routes/product-json"
import { findLeafCategoryId, login, seedCredentials } from "./helpers"

const PRODUCT = {
  title: "Caja almacenamiento 1450L Caseta",
  description: "Caja de almacenamiento de resina Duramax de 1450 litros. Medidas 202x122x180 cm. Nueva en caja.",
  price: 184.95,
}
const REWRITE = {
  title: "Arcón de jardín Duramax 1450 L",
  description: "Arcón Duramax de resina de 1450 litros, a estrenar y en su caja. Mide 202x122x180 cm.",
}

function prismaOrThrow() {
  const prisma = getPrisma()
  if (!prisma) throw new Error("Database is not configured.")
  return prisma
}

async function readyFor(productId: string, accountId: string): Promise<PublishReady> {
  const prisma = prismaOrThrow()
  const product = await loadProductCard(prisma, productId)
  if (!product) throw new Error("product not found")
  return {
    ok: true,
    prisma,
    product,
    accountId,
    dryRun: true,
    imagePaths: [],
    categoryLabels: [],
    shippingEnabled: false,
    packageType: "STANDARD",
    weightKg: null,
    widthCm: null,
    lengthCm: null,
    heightCm: null,
  }
}

describe("publish run sends the duplicate text to the Wallapop form", () => {
  let app: Express
  let agent: request.Agent
  let productId: string
  let secondAccountId: string
  let defaultAccountId: string
  const where = () => ({ productId_accountId: { productId, accountId: secondAccountId } })

  beforeAll(async () => {
    app = createApp()
    const { email, password } = seedCredentials()
    const loggedIn = await login(app, email, password)
    if (loggedIn.res.status !== 200) throw new Error(`login failed: ${loggedIn.res.status}`)
    agent = loggedIn.agent
    const categoryId = await findLeafCategoryId(agent)
    const created = await agent.post("/api/v1/products").send({
      sku: `API-PUBTXT-${Date.now()}`,
      ...PRODUCT,
      currency: "EUR",
      categoryId,
      condition: "NEW",
      brand: "Duramax",
    })
    expect(created.status).toBe(201)
    productId = created.body.product?.id as string
    const prisma = prismaOrThrow()
    const taken = await prisma.account.findMany({ select: { chromeSlot: true } })
    const second = await prisma.account.create({
      data: { name: "Publish text test", isDefault: false, chromeSlot: nextChromeSlot(taken.map((r) => r.chromeSlot)) },
      select: { id: true },
    })
    secondAccountId = second.id
    const fallback = await prisma.account.findFirst({ where: { isDefault: true }, select: { id: true } })
    defaultAccountId = fallback?.id ?? ""
  })

  beforeEach(() => {
    browser.calls.length = 0
    setVariantModelForTests(async () => {
      throw new Error("publish must not call the AI")
    })
  })

  afterAll(async () => {
    setVariantModelForTests(null)
    if (productId) await agent.delete(`/api/v1/products/${productId}`)
    if (secondAccountId) await prismaOrThrow().account.delete({ where: { id: secondAccountId } })
  })

  it("never opens the form without saved text: the duplicate goes back to PREPARING", async () => {
    const prisma = prismaOrThrow()
    await prisma.productListing.create({
      data: { productId, accountId: secondAccountId, status: "POSTING", postingAttempts: 1 },
    })
    const result = await executeLivePublish(await readyFor(productId, secondAccountId), productId, true)
    expect(result.ok).toBe(false)
    expect(browser.calls).toHaveLength(0)
    const row = await prisma.productListing.findUnique({ where: where() })
    expect(row).toMatchObject({ status: "PREPARING", postingAttempts: 0, lastPublishError: null })
  })

  it("fills the form with the saved duplicate text and the account price", async () => {
    const prisma = prismaOrThrow()
    setVariantModelForTests(async () => REWRITE)
    const saved = await agent
      .post(`/api/v1/products/${productId}/variant/regenerate`)
      .send({ accountId: secondAccountId })
    expect(saved.status).toBe(200)
    setVariantModelForTests(async () => {
      throw new Error("publish must not call the AI")
    })
    await prisma.productListing.update({ where: where(), data: { status: "POSTING" } })
    const result = await executeLivePublish(await readyFor(productId, secondAccountId), productId, true)
    expect(result.ok).toBe(true)
    expect(browser.calls).toEqual([{ ...REWRITE, price: 184.98 }])
  })

  it("fills the form with the original text on the default account", async () => {
    const result = await executeLivePublish(await readyFor(productId, defaultAccountId), productId, false)
    expect(result.ok).toBe(true)
    expect(browser.calls).toEqual([PRODUCT])
  })
})
