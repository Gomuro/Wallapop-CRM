import type { Express } from "express"
import request from "supertest"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"

import { createApp } from "../src/app"
import { nextChromeSlot } from "../src/lib/account-chrome"
import { getPrisma } from "../src/lib/db"
import { setVariantModelForTests } from "../src/lib/listing-variant/generate"
import { publishTextForListing } from "../src/lib/listing-variant/publish-text"
import { prepareStaleDuplicates, processPendingVariants } from "../src/lib/listing-variant/worker"
import { siblingQueueOffWhere } from "../src/lib/product-sold"
import { findLeafCategoryId, login, seedCredentials } from "./helpers"

const TITLE = "Caja almacenamiento 1450L Caseta"
const DESCRIPTION =
  "Caja de almacenamiento de resina Duramax de 1450 litros. Medidas 202x122x180 cm. Nueva en caja, ideal para jardín."
const REWRITE = {
  title: "Arcón de jardín Duramax 1450 L",
  description:
    "Arcón Duramax de resina con capacidad de 1450 litros, a estrenar y en su caja. Mide 202x122x180 cm, perfecto para guardar cosas del jardín.",
}
const PRODUCT = { title: TITLE, description: DESCRIPTION, price: 184.95 }

function prismaOrThrow() {
  const prisma = getPrisma()
  if (!prisma) throw new Error("Database is not configured.")
  return prisma
}

function modelDown() {
  setVariantModelForTests(async () => {
    throw new Error("OpenRouter and Groq down (test)")
  })
}

describe("duplicate text on a second account (Express + Postgres)", () => {
  let app: Express
  let agent: request.Agent
  let productId: string
  let secondAccountId: string
  let defaultAccountId: string
  const where = () => ({ productId_accountId: { productId, accountId: secondAccountId } })

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

  it("queues a duplicate without text as PREPARING, even with the AI down", async () => {
    modelDown()
    const res = await agent.post(`/api/v1/products/${productId}/queue`).send({ accountId: secondAccountId })
    expect(res.status).toBe(200)
    expect(res.body.listing?.status).toBe("PREPARING")
  })

  it("never publishes it without saved text and never asks the AI at publish time", async () => {
    setVariantModelForTests(async () => {
      throw new Error("publish must not call the AI")
    })
    const prisma = prismaOrThrow()
    await prisma.productListing.update({ where: where(), data: { status: "POSTING", postingAttempts: 1 } })
    await expect(
      publishTextForListing(prisma, { id: productId, ...PRODUCT }, secondAccountId),
    ).rejects.toThrow(/preparando/)
    const row = await prisma.productListing.findUnique({ where: where() })
    expect(row).toMatchObject({ status: "PREPARING", postingAttempts: 0 })
  })

  it("retries later when the AI fails, then promotes to READY_TO_POST with a ,98 price", async () => {
    const prisma = prismaOrThrow()
    const now = new Date()
    modelDown()
    await processPendingVariants(prisma, now)
    const failed = await prisma.productListing.findUnique({ where: where() })
    expect(failed?.status).toBe("PREPARING")
    expect(failed?.variantAttempts).toBe(1)
    expect(failed?.variantNextAttemptAt?.getTime()).toBe(now.getTime() + 10 * 60_000)

    setVariantModelForTests(async () => REWRITE)
    await processPendingVariants(prisma, now)
    expect((await prisma.productListing.findUnique({ where: where() }))?.status).toBe("PREPARING")
    await processPendingVariants(prisma, new Date(now.getTime() + 11 * 60_000))
    const ready = await prisma.productListing.findUnique({ where: where() })
    expect(ready).toMatchObject({ status: "READY_TO_POST", variantTitle: REWRITE.title, variantAttempts: 0 })
    expect(Number(ready?.variantPrice)).toBe(184.98)
  })

  it("publishes the saved duplicate text, and the original on the default account", async () => {
    const prisma = prismaOrThrow()
    const product = { id: productId, ...PRODUCT }
    expect(await publishTextForListing(prisma, product, secondAccountId)).toEqual({ ...REWRITE, price: 184.98 })
    expect(await publishTextForListing(prisma, product, defaultAccountId)).toEqual({
      title: TITLE,
      description: DESCRIPTION,
      price: 184.95,
    })
  })

  it("sends an AI text back to PREPARING when the product text changes", async () => {
    const prisma = prismaOrThrow()
    await prisma.product.update({ where: { id: productId }, data: { description: `${DESCRIPTION} Color verde.` } })
    expect(await prepareStaleDuplicates(prisma, productId)).toBe(1)
    expect((await prisma.productListing.findUnique({ where: where() }))?.status).toBe("PREPARING")
  })

  it("takes a PREPARING duplicate off the queue when the product is sold elsewhere", async () => {
    const prisma = prismaOrThrow()
    const waiting = await prisma.productListing.count({
      where: { ...siblingQueueOffWhere(productId, defaultAccountId), accountId: secondAccountId },
    })
    expect(waiting).toBe(1)
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
    expect(manual.body.variant).toMatchObject({ title: "Arcón Duramax 1450 L", source: "manual", attempts: 0 })
    expect((await prismaOrThrow().productListing.findUnique({ where: where() }))?.status).toBe("READY_TO_POST")
    await prismaOrThrow().productListing.update({ where: where(), data: { status: "ACTIVE" } })
    const locked = await agent
      .post(`/api/v1/products/${productId}/variant/regenerate`)
      .send({ accountId: secondAccountId })
    expect(locked.status).toBe(409)
  })
})
