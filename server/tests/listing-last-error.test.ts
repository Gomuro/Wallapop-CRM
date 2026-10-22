import type { Express } from "express"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createApp } from "../src/app"
import { getPrisma } from "../src/lib/db"
import { toListingJson } from "../src/lib/listing-json"
import { findLeafCategoryId, login, seedCredentials } from "./helpers"

const baseRow = {
  id: "l1",
  status: "FAILED",
  externalUrl: null,
  externalItemId: null,
  shippingEnabled: true,
  shippingUpToKg: null,
  accountId: "a1",
  lastPostedAt: null,
}

describe("toListingJson lastPublishError", () => {
  it("passes the reason through when the query selected it", () => {
    expect(toListingJson({ ...baseRow, lastPublishError: "Pausado" })).toMatchObject({
      lastPublishError: "Pausado",
    })
    expect(toListingJson({ ...baseRow, lastPublishError: null })).toMatchObject({
      lastPublishError: null,
    })
  })

  it("leaves the key out when the query did not select it", () => {
    expect(toListingJson(baseRow)).not.toHaveProperty("lastPublishError")
  })
})

describe("lastPublishError reaches the API response (Express + Postgres)", () => {
  let app: Express
  let agent: request.Agent
  let productId: string
  const reason = "Pausado tras 3 intentos fallidos seguidos (test)"

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
      sku: `API-ERR-${Date.now()}`,
      title: "API last error",
      description: "Vitest lastPublishError",
      price: 5,
      currency: "EUR",
      categoryId,
      condition: "GOOD",
      brand: "Acme",
    })
    expect(created.status).toBe(201)
    productId = created.body.product?.id as string
  })

  afterAll(async () => {
    if (productId) await agent.delete(`/api/v1/products/${productId}`)
  })

  it("returns the stored reason on the listing of a FAILED product", async () => {
    const prisma = getPrisma()
    if (!prisma) throw new Error("Database is not configured.")
    await prisma.productListing.updateMany({
      where: { productId },
      data: { status: "FAILED", lastPublishError: reason },
    })
    const res = await agent.get(`/api/v1/products/${productId}`)
    expect(res.status).toBe(200)
    expect(res.body.product?.listing?.status).toBe("FAILED")
    expect(res.body.product?.listing?.lastPublishError).toBe(reason)
    expect(res.body.product?.listings?.[0]?.lastPublishError).toBe(reason)
  })
})
