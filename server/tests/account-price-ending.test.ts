import type { Express } from "express"
import type request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createApp } from "../src/app"
import { nextChromeSlot } from "../src/lib/account-chrome"
import { getPrisma } from "../src/lib/db"
import { DUPLICATE_SAME_PRICE_MESSAGE, publishTextForListing } from "../src/lib/listing-variant/publish-text"
import { writeListingVariant } from "../src/lib/listing-variant/worker"
import { errorCode, findLeafCategoryId, login, seedCredentials } from "./helpers"

function prismaOrThrow() {
  const prisma = getPrisma()
  if (!prisma) throw new Error("Database is not configured.")
  return prisma
}

describe("PATCH /accounts/:id/price-ending", () => {
  const stamp = Date.now()
  let app: Express
  let agent: request.Agent
  let defaultId = ""
  const accountIds: string[] = []
  const productIds: string[] = []
  const listing: Record<string, string> = {}

  async function account(name: string, priceEnding: number) {
    const prisma = prismaOrThrow()
    const taken = await prisma.account.findMany({ select: { chromeSlot: true } })
    const row = await prisma.account.create({
      data: { name, isDefault: false, priceEnding, chromeSlot: nextChromeSlot(taken.map((r) => r.chromeSlot)) },
      select: { id: true },
    })
    accountIds.push(row.id)
    return row.id
  }

  async function duplicate(key: string, accountId: string, status: "READY_TO_POST" | "PREPARING" | "ACTIVE" | "POSTING", variantPrice: number | null) {
    const categoryId = await findLeafCategoryId(agent)
    const created = await agent.post("/api/v1/products").send({
      sku: `API-ENDING-${key}-${stamp}`,
      title: `Producto terminación ${key}`,
      description: "Producto de prueba para la terminación del precio de los duplicados.",
      price: 59.95,
      currency: "EUR",
      categoryId,
      condition: "NEW",
    })
    expect(created.status).toBe(201)
    const productId = created.body.product?.id as string
    productIds.push(productId)
    const row = await prismaOrThrow().productListing.create({
      data: { productId, accountId, status, variantPrice },
      select: { id: true },
    })
    listing[key] = row.id
  }

  async function priceOf(key: string) {
    const row = await prismaOrThrow().productListing.findUnique({ where: { id: listing[key] }, select: { variantPrice: true } })
    return row?.variantPrice == null ? null : Number(row.variantPrice.toString())
  }

  let second = ""
  let third = ""

  beforeAll(async () => {
    app = createApp()
    const { email, password } = seedCredentials()
    const loggedIn = await login(app, email, password)
    if (loggedIn.res.status !== 200) throw new Error(`login failed: ${loggedIn.res.status}`)
    agent = loggedIn.agent
    const fallback = await prismaOrThrow().account.findFirst({ where: { isDefault: true }, select: { id: true } })
    defaultId = fallback?.id ?? ""
    second = await account(`Ending second ${stamp}`, 98)
    third = await account(`Ending third ${stamp}`, 97)
    await duplicate("ready", second, "READY_TO_POST", 59.98)
    await duplicate("preparing", second, "PREPARING", 59.98)
    await duplicate("notext", second, "PREPARING", null)
    await duplicate("live", second, "ACTIVE", 59.98)
    await duplicate("posting", second, "POSTING", 59.98)
  })

  afterAll(async () => {
    for (const id of productIds) await agent.delete(`/api/v1/products/${id}`)
    for (const id of accountIds) await prismaOrThrow().account.delete({ where: { id } })
  })

  it("refuses the default account, which publishes the original price", async () => {
    const res = await agent.patch(`/api/v1/accounts/${defaultId}/price-ending`).send({ priceEnding: 90 })
    expect(res.status).toBe(409)
    expect(errorCode(res.body)).toBe("DEFAULT_ACCOUNT")
  })

  it("accepts only 0 to 99", async () => {
    for (const priceEnding of [100, -1, 9.5]) {
      const res = await agent.patch(`/api/v1/accounts/${second}/price-ending`).send({ priceEnding })
      expect(res.status).toBe(400)
    }
  })

  it("refuses the ending another account already uses", async () => {
    const res = await agent.patch(`/api/v1/accounts/${second}/price-ending`).send({ priceEnding: 97 })
    expect(res.status).toBe(409)
    expect(errorCode(res.body)).toBe("PRICE_ENDING_TAKEN")
    expect(await priceOf("ready")).toBe(59.98)
  })

  it("saves the ending and reprices only the queued duplicates", async () => {
    const res = await agent.patch(`/api/v1/accounts/${second}/price-ending`).send({ priceEnding: 90 })
    expect(res.status).toBe(200)
    expect(res.body.account.priceEnding).toBe(90)
    expect(res.body.repriced).toBe(2)
    expect(await priceOf("ready")).toBe(59.9)
    expect(await priceOf("preparing")).toBe(59.9)
    expect(await priceOf("notext")).toBeNull()
    expect(await priceOf("live")).toBe(59.98)
    expect(await priceOf("posting")).toBe(59.98)
    const listed = await agent.get("/api/v1/accounts")
    expect(listed.body.accounts.find((row: { id: string }) => row.id === second)?.priceEnding).toBe(90)
  })

  it("lets the account keep its own ending", async () => {
    const res = await agent.patch(`/api/v1/accounts/${third}/price-ending`).send({ priceEnding: 97 })
    expect(res.status).toBe(200)
    expect(res.body.repriced).toBe(0)
  })

  it("refuses an ending that active product prices already end in, and names them", async () => {
    const res = await agent.patch(`/api/v1/accounts/${second}/price-ending`).send({ priceEnding: 95 })
    expect(res.status).toBe(409)
    expect(errorCode(res.body)).toBe("PRICE_ENDING_MATCHES_PRODUCTS")
    expect(res.body.error.message).toMatch(/productos? activos? cuyo precio ya acaba en ,95/)
    expect(res.body.error.message).toMatch(/API-ENDING-/)
  })
})

describe("a duplicate that would cost the same as the original", () => {
  const stamp = Date.now()
  let app: Express
  let agent: request.Agent
  let accountId = ""
  let productId = ""
  const where = () => ({ productId_accountId: { productId, accountId } })

  beforeAll(async () => {
    const { email, password } = seedCredentials()
    app = createApp()
    const loggedIn = await login(app, email, password)
    if (loggedIn.res.status !== 200) throw new Error(`login failed: ${loggedIn.res.status}`)
    agent = loggedIn.agent
    const prisma = prismaOrThrow()
    const taken = await prisma.account.findMany({ select: { chromeSlot: true } })
    const row = await prisma.account.create({
      data: { name: `Same price ${stamp}`, isDefault: false, priceEnding: 96, chromeSlot: nextChromeSlot(taken.map((r) => r.chromeSlot)) },
      select: { id: true },
    })
    accountId = row.id
    const categoryId = await findLeafCategoryId(agent)
    const created = await agent.post("/api/v1/products").send({
      sku: `API-SAMEPRICE-${stamp}`,
      title: "Producto precio igual",
      description: "Producto de prueba cuyo precio ya acaba en la terminación de la cuenta.",
      price: 19.96,
      currency: "EUR",
      categoryId,
      condition: "NEW",
    })
    productId = created.body.product?.id as string
    await prisma.productListing.create({
      data: {
        productId,
        accountId,
        status: "PREPARING",
        variantTitle: "Texto manual del duplicado",
        variantDescription: "Descripción manual del duplicado para la prueba.",
        variantSource: "manual",
      },
    })
  })

  afterAll(async () => {
    if (productId) await agent.delete(`/api/v1/products/${productId}`)
    if (accountId) await prismaOrThrow().account.delete({ where: { id: accountId } })
  })

  it("is not queued: the background writer marks it FAILED with the reason", async () => {
    const prisma = prismaOrThrow()
    const outcome = await writeListingVariant(prisma, { productId, accountId, status: "PREPARING", variantAttempts: 0 })
    expect(outcome.ok).toBe(true)
    const row = await prisma.productListing.findUnique({ where: where(), select: { status: true, lastPublishError: true } })
    expect(row).toEqual({ status: "FAILED", lastPublishError: DUPLICATE_SAME_PRICE_MESSAGE })
  })

  it("never reaches the form: a claimed one goes back to FAILED before Chrome", async () => {
    const prisma = prismaOrThrow()
    await prisma.productListing.update({ where: where(), data: { status: "POSTING", postingAttempts: 1, lastPublishError: null } })
    await expect(
      publishTextForListing(prisma, { id: productId, title: "Producto precio igual", description: "x", price: 19.96 }, accountId),
    ).rejects.toThrow(DUPLICATE_SAME_PRICE_MESSAGE)
    const row = await prisma.productListing.findUnique({ where: where(), select: { status: true, postingAttempts: true, lastPublishError: true } })
    expect(row).toEqual({ status: "FAILED", postingAttempts: 0, lastPublishError: DUPLICATE_SAME_PRICE_MESSAGE })
  })
})
