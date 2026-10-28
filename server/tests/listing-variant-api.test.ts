import type { Express } from "express"
import request from "supertest"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"

import { createApp } from "../src/app"
import { nextChromeSlot } from "../src/lib/account-chrome"
import { getPrisma } from "../src/lib/db"
import { setVariantModelForTests } from "../src/lib/listing-variant/generate"
import { publishTextForListing } from "../src/lib/listing-variant/publish-text"
import { errorCode, findLeafCategoryId, login, seedCredentials } from "./helpers"

const TITLE = "Caja almacenamiento 1450L Caseta"
const DESCRIPTION =
  "Caja de almacenamiento de resina Duramax de 1450 litros. Medidas 202x122x180 cm. Nueva en caja, ideal para jardín."
const REWRITE = {
  title: "Arcón de jardín Duramax 1450 L",
  description:
    "Arcón Duramax de resina con capacidad de 1450 litros, a estrenar y en su caja. Mide 202x122x180 cm, perfecto para guardar cosas del jardín.",
}

function prismaOrThrow() {
  const prisma = getPrisma()
  if (!prisma) throw new Error("Database is not configured.")
  return prisma
}

describe("duplicate variant on a second account (Express + Postgres)", () => {
  let app: Express
  let agent: request.Agent
  let productId: string
  let secondAccountId: string
  let defaultAccountId: string

  beforeAll(async () => {
    app = createApp()
    const health = await request(app).get("/health")
    if (health.status !== 200) throw new Error(`GET /health failed (${health.status})`)
    const { email, password } = seedCredentials()
    const loggedIn = await login(app, email, password)
    if (loggedIn.res.status !== 200) throw new Error(`login failed: ${loggedIn.res.status}`)
    agent = loggedIn.agent
    const categoryId = await findLeafCategoryId(agent)
    const created = await agent.post("/api/v1/products").send({
      sku: `API-VAR-${Date.now()}`,
      title: TITLE,
      description: DESCRIPTION,
      price: 184.95,
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
      data: { name: "Variant test", isDefault: false, chromeSlot: nextChromeSlot(taken.map((r) => r.chromeSlot)) },
      select: { id: true },
    })
    secondAccountId = second.id
    const fallback = await prisma.account.findFirst({ where: { isDefault: true }, select: { id: true } })
    defaultAccountId = fallback?.id ?? ""
  })

  afterEach(() => setVariantModelForTests(null))

  afterAll(async () => {
    if (productId) await agent.delete(`/api/v1/products/${productId}`)
    if (secondAccountId) await prismaOrThrow().account.delete({ where: { id: secondAccountId } })
  })

  it("does not queue the duplicate when the AI fails, and says why", async () => {
    setVariantModelForTests(async () => {
      throw new Error("Groq HTTP 503")
    })
    const res = await agent.post(`/api/v1/products/${productId}/queue`).send({ accountId: secondAccountId })
    expect(res.status).toBe(422)
    expect(errorCode(res.body)).toBe("VARIANT_FAILED")
    const row = await prismaOrThrow().productListing.findUnique({
      where: { productId_accountId: { productId, accountId: secondAccountId } },
    })
    expect(row).toBeNull()
  })

  it("queues with its own text and a ,98 price, shown on the product detail", async () => {
    setVariantModelForTests(async () => REWRITE)
    const res = await agent.post(`/api/v1/products/${productId}/queue`).send({ accountId: secondAccountId })
    expect(res.status).toBe(200)
    expect(res.body.listing?.status).toBe("READY_TO_POST")
    const detail = await agent.get(`/api/v1/products/${productId}`)
    const second = (detail.body.product?.listings as { accountId: string; variant: unknown }[]).find(
      (row) => row.accountId === secondAccountId,
    )
    expect(second?.variant).toMatchObject({ ...REWRITE, price: 184.98, source: "ai", stale: false })
  })

  it("gives the publish form the duplicate text, and the original on the default account", async () => {
    setVariantModelForTests(async () => {
      throw new Error("must reuse the saved variant")
    })
    const product = { id: productId, title: TITLE, description: DESCRIPTION, price: 184.95 }
    const prisma = prismaOrThrow()
    expect(await publishTextForListing(prisma, product, secondAccountId)).toEqual({
      ...REWRITE,
      price: 184.98,
    })
    expect(await publishTextForListing(prisma, product, defaultAccountId)).toEqual({
      title: TITLE,
      description: DESCRIPTION,
      price: 184.95,
    })
  })

  it("keeps a manual text, rejects a long title, and locks a live duplicate", async () => {
    const tooLong = await agent
      .put(`/api/v1/products/${productId}/variant`)
      .send({ accountId: secondAccountId, title: "x".repeat(51), description: "algo" })
    expect(tooLong.status).toBe(400)
    const manual = await agent
      .put(`/api/v1/products/${productId}/variant`)
      .send({ accountId: secondAccountId, title: "Arcón Duramax 1450 L", description: REWRITE.description })
    expect(manual.status).toBe(200)
    expect(manual.body.variant).toMatchObject({ title: "Arcón Duramax 1450 L", source: "manual" })
    await prismaOrThrow().productListing.updateMany({
      where: { productId, accountId: secondAccountId },
      data: { status: "ACTIVE" },
    })
    const locked = await agent
      .post(`/api/v1/products/${productId}/variant/regenerate`)
      .send({ accountId: secondAccountId })
    expect(locked.status).toBe(409)
  })
})
