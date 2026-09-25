import type { Express } from "express"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import request from "supertest"

import { createApp } from "../src/app"
import {
  errorCode,
  findLeafCategoryId,
  login,
  seedCredentials,
  tinyPngBuffer,
} from "./helpers"

describe("API v1 integration (Express + Postgres)", () => {
  let app: Express
  const { email, password } = seedCredentials()
  let agent: request.Agent
  let productId: string
  let sku: string

  beforeAll(async () => {
    app = createApp()
    const health = await request(app).get("/health")
    if (health.status !== 200) {
      throw new Error(
        `GET /health failed (${health.status}). Start DB: npm run db:up && npm run db:migrate:deploy && npm run db:seed`,
      )
    }
    const loggedIn = await login(app, email, password)
    if (loggedIn.res.status !== 200) {
      throw new Error(`login failed: ${loggedIn.res.status} ${JSON.stringify(loggedIn.res.body)}`)
    }
    const rawSetCookie = loggedIn.res.headers["set-cookie"]
    const setCookies =
      rawSetCookie === undefined
        ? []
        : Array.isArray(rawSetCookie)
          ? rawSetCookie
          : [rawSetCookie]
    if (!setCookies.some((raw) => raw.startsWith("crm_session="))) {
      throw new Error(
        `login missing crm_session cookie (check COOKIE_SECURE in test setup): ${JSON.stringify(setCookies)}`,
      )
    }
    agent = loggedIn.agent
  })

  describe("auth", () => {
    it("returns 401 for anonymous GET /products", async () => {
      const res = await request(app).get("/api/v1/products")
      expect(res.status).toBe(401)
      expect(errorCode(res.body)).toBe("UNAUTHORIZED")
    })

    it("rejects bad password on login", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email, password: "wrong-password" })
      expect(res.status).toBe(401)
    })

    it("returns user on GET /auth/me when logged in", async () => {
      const res = await agent.get("/api/v1/auth/me")
      expect(res.status).toBe(200)
      expect(res.body.user?.email).toBe(email)
    })

    it("clears session on logout", async () => {
      const logoutAgent = await login(app, email, password)
      const logout = await logoutAgent.agent.post("/api/v1/auth/logout")
      expect(logout.status).toBe(200)
      const me = await logoutAgent.agent.get("/api/v1/auth/me")
      expect(me.status).toBe(401)
      expect(errorCode(me.body)).toBe("UNAUTHORIZED")
    })
  })

  describe("products list", () => {
    it("paginates with page and pageSize", async () => {
      const res = await agent.get("/api/v1/products?page=1&pageSize=20")
      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.products)).toBe(true)
      expect(res.body.page).toBe(1)
      expect(res.body.pageSize).toBe(20)
      expect(typeof res.body.total).toBe("number")
      expect(typeof res.body.totalPages).toBe("number")
    })
  })

  describe("product lifecycle", () => {
    it("creates product in leaf category", async () => {
      const categoryId = await findLeafCategoryId(agent)
      sku = `API-TEST-${Date.now()}`
      const res = await agent.post("/api/v1/products").send({
        sku,
        title: "API test product",
        description: "Vitest integration #61",
        price: 9.99,
        currency: "EUR",
        categoryId,
        condition: "GOOD",
      })
      expect(res.status).toBe(201)
      productId = res.body.product?.id as string
      expect(productId).toBeTruthy()
    })

    it("gets product by id", async () => {
      const res = await agent.get(`/api/v1/products/${productId}`)
      expect(res.status).toBe(200)
      expect(res.body.product?.sku).toBe(sku)
    })

    it("rejects status on PATCH card body", async () => {
      const res = await agent
        .patch(`/api/v1/products/${productId}`)
        .send({ status: "INACTIVE" })
      expect(res.status).toBe(400)
    })

    it("searches by q in list", async () => {
      const res = await agent.get(
        `/api/v1/products?page=1&pageSize=50&q=${encodeURIComponent(sku)}`,
      )
      expect(res.status).toBe(200)
      const items = res.body.products as Array<{ sku?: string }>
      expect(items.some((p) => p.sku === sku)).toBe(true)
    })
  })

  describe("listing (#65)", () => {
    it("GET default listing READY_TO_POST", async () => {
      const res = await agent.get(`/api/v1/products/${productId}/listing`)
      expect(res.status).toBe(200)
      expect(res.body.listing?.status).toBe("READY_TO_POST")
      expect(res.body.listing?.externalUrl).toBeNull()
    })

    it("PUT listing externalUrl and ACTIVE", async () => {
      const wallapopUrl = "https://es.wallapop.com/item/api-test"
      const put = await agent
        .put(`/api/v1/products/${productId}/listing`)
        .send({ externalUrl: wallapopUrl, status: "ACTIVE" })
      expect(put.status).toBe(200)
      expect(put.body.listing?.status).toBe("ACTIVE")
      expect(put.body.listing?.externalUrl).toBe(wallapopUrl)

      const get = await agent.get(`/api/v1/products/${productId}/listing`)
      expect(get.status).toBe(200)
      expect(get.body.listing?.status).toBe("ACTIVE")
      expect(get.body.listing?.externalUrl).toBe(wallapopUrl)
    })
  })

  describe("photos", () => {
    it("POST multipart image", async () => {
      const png = await tinyPngBuffer()
      const res = await agent
        .post(`/api/v1/products/${productId}/images`)
        .attach("files", png, { filename: "test.png", contentType: "image/png" })
      expect(res.status).toBe(201)
      const images = res.body.product?.images as Array<{ sortOrder: number }>
      expect(images?.length).toBeGreaterThan(0)
      expect(images[0].sortOrder).toBe(0)
    })

    it("list includes coverUrl after upload", async () => {
      const res = await agent.get(
        `/api/v1/products?page=1&pageSize=50&q=${encodeURIComponent(sku)}`,
      )
      expect(res.status).toBe(200)
      const items = res.body.products as Array<{ coverUrl?: string | null }>
      expect(items[0]?.coverUrl).toBeTruthy()
    })
  })

  describe("status and sold (#57)", () => {
    it("PATCH /status INACTIVE then ACTIVE", async () => {
      const inactive = await agent
        .patch(`/api/v1/products/${productId}/status`)
        .send({ status: "INACTIVE" })
      expect(inactive.status).toBe(200)
      expect(inactive.body.product?.status).toBe("INACTIVE")

      const active = await agent
        .patch(`/api/v1/products/${productId}/status`)
        .send({ status: "ACTIVE" })
      expect(active.status).toBe(200)
      expect(active.body.product?.status).toBe("ACTIVE")
    })

    it("POST sold sets SOLD and deactivates listing", async () => {
      const res = await agent.post(`/api/v1/products/${productId}/sold`)
      expect(res.status).toBe(200)
      expect(res.body.product?.status).toBe("SOLD")
      expect(res.body.product?.soldAt).toBeTruthy()
      expect(res.body.product?.listing?.status).toBe("DEACTIVATED")
    })

    it("list shows listingActive false after sold", async () => {
      const res = await agent.get(
        `/api/v1/products?page=1&pageSize=50&q=${encodeURIComponent(sku)}`,
      )
      expect(res.status).toBe(200)
      const item = res.body.products?.[0] as { listingActive?: boolean }
      expect(item?.listingActive).toBe(false)
    })

    it("repeat POST sold returns 409 ALREADY_SOLD", async () => {
      const res = await agent.post(`/api/v1/products/${productId}/sold`)
      expect(res.status).toBe(409)
      expect(errorCode(res.body)).toBe("ALREADY_SOLD")
    })
  })

  afterAll(async () => {
    if (!productId || !agent) return
    await agent.delete(`/api/v1/products/${productId}`)
  })
})
