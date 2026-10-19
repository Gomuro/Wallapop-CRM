import type { Express } from "express"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import request from "supertest"

import { createApp } from "../src/app"
import { nextChromeSlot } from "../src/lib/account-chrome"
import { getPrisma } from "../src/lib/db"
import { findDefaultAccountId } from "../src/lib/default-account"
import { deactivateListingAfterEliminar } from "../src/lib/product-eliminar"
import {
  markProductSoldTx,
  requeueSoldProductAfterReturn,
} from "../src/lib/product-sold"
import { syncWallapopIdentityOnActive } from "../src/lib/wallapop-account-identity"
import {
  activatePostingListing,
  claimListingForPublish,
  listingBlocksDryRun,
  revertPublishClaim,
  shouldRevertPublishClaim,
} from "../src/routes/product-publish"
import {
  errorCode,
  findLeafCategoryId,
  login,
  seedCredentials,
  tinyPngBuffer,
} from "./helpers"

async function createSideAccount(name: string) {
  const prisma = getPrisma()
  if (!prisma) throw new Error("Database is not configured.")
  const taken = await prisma.account.findMany({ select: { chromeSlot: true } })
  return prisma.account.create({
    data: {
      name,
      isDefault: false,
      chromeSlot: nextChromeSlot(taken.map((row) => row.chromeSlot)),
    },
    select: { id: true },
  })
}

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

  describe("accounts autopost interval", () => {
    let previousMs: number | null = null

    beforeAll(async () => {
      const res = await agent.get("/api/v1/accounts/default")
      expect(res.status).toBe(200)
      previousMs = res.body.account?.autopostIntervalMs ?? null
    })

    afterAll(async () => {
      const prisma = getPrisma()
      if (!prisma) return
      await prisma.account.updateMany({
        where: { isDefault: true },
        data: { autopostIntervalMs: previousMs },
      })
    })

    it("GET default includes autopost status", async () => {
      const res = await agent.get("/api/v1/accounts/default")
      expect(res.status).toBe(200)
      expect(res.body.account?.isDefault).toBe(true)
      expect(res.body.account).toHaveProperty("autopostIntervalMs")
      expect(res.body.autopost).toMatchObject({
        jitterFraction: 0.2,
      })
      expect(typeof res.body.autopost.effectiveIntervalMs).toBe("number")
      expect(["account", "env", "default"]).toContain(res.body.autopost.source)
      expect(typeof res.body.autopost.enabled).toBe("boolean")
      expect(typeof res.body.autopost.livePublish).toBe("boolean")
      expect(
        res.body.autopost.nextTickAt === null ||
          typeof res.body.autopost.nextTickAt === "string",
      ).toBe(true)
      expect(Array.isArray(res.body.autopost.recentSkips)).toBe(true)
    })

    it("PATCH stores the interval and GET reflects source account", async () => {
      const patch = await agent
        .patch("/api/v1/accounts/default/autopost")
        .send({ value: 2, unit: "hours" })
      expect(patch.status).toBe(200)
      expect(patch.body.account?.autopostIntervalMs).toBe(2 * 60 * 60 * 1000)
      expect(patch.body.autopost).toMatchObject({
        effectiveIntervalMs: 2 * 60 * 60 * 1000,
        source: "account",
        jitterFraction: 0.2,
      })

      const get = await agent.get("/api/v1/accounts/default")
      expect(get.status).toBe(200)
      expect(get.body.account?.autopostIntervalMs).toBe(2 * 60 * 60 * 1000)
      expect(get.body.autopost.source).toBe("account")
      expect(get.body.autopost.effectiveIntervalMs).toBe(2 * 60 * 60 * 1000)
    })

    it("PATCH rejects intervals outside 1 minute … 7 days", async () => {
      const tooShort = await agent
        .patch("/api/v1/accounts/default/autopost")
        .send({ value: 30, unit: "seconds" })
      expect(tooShort.status).toBe(400)
      expect(errorCode(tooShort.body)).toBe("VALIDATION_ERROR")

      const tooLong = await agent
        .patch("/api/v1/accounts/default/autopost")
        .send({ value: 8, unit: "days" })
      expect(tooLong.status).toBe(400)
      expect(errorCode(tooLong.body)).toBe("VALIDATION_ERROR")
    })

    it("rejects anonymous PATCH", async () => {
      const res = await request(app)
        .patch("/api/v1/accounts/default/autopost")
        .send({ value: 15, unit: "minutes" })
      expect(res.status).toBe(401)
    })

    it("Start without an ACTIVE Wallapop session is 409", async () => {
      const res = await agent.post("/api/v1/accounts/default/autopost/start")
      expect(res.status).toBe(409)
      expect(errorCode(res.body)).toBe("NOT_ACTIVE")
    })

    it("Stop writes autopostEnabled false", async () => {
      const res = await agent.post("/api/v1/accounts/default/autopost/stop")
      expect(res.status).toBe(200)
      expect(res.body.autopost?.enabled).toBe(false)
      expect(res.body.autopost).toHaveProperty("lastPublication")
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
        brand: "Acme",
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

    it("lists Wallapop catalog brands for a category", async () => {
      const anon = await request(app).get("/api/v1/brands")
      expect(anon.status).toBe(401)
      const prisma = getPrisma()
      const leaf = await prisma?.category.findUnique({
        where: { wallapopId: 9839 },
        select: { id: true },
      })
      expect(leaf?.id).toBeTruthy()
      const res = await agent.get(
        `/api/v1/brands?categoryId=${encodeURIComponent(leaf!.id)}&q=Ni`,
      )
      expect(res.status).toBe(200)
      expect(res.body.brands).toContain("Nike")
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
      const items = res.body.products as Array<{
        sku?: string
        listingStatus?: string | null
        listingActive?: boolean
      }>
      const item = items.find((p) => p.sku === sku)
      expect(item).toBeTruthy()
      expect(item?.listingStatus).toBe("READY_TO_POST")
      expect(item?.listingActive).toBe(false)
    })
  })

  describe("listing (#65)", () => {
    it("GET default listing READY_TO_POST", async () => {
      const res = await agent.get(`/api/v1/products/${productId}/listing`)
      expect(res.status).toBe(200)
      expect(res.body.listing?.status).toBe("READY_TO_POST")
      expect(res.body.listing?.externalUrl).toBeNull()
      expect(res.body.listing?.shippingEnabled).toBe(true)
    })

    it("PUT shippingEnabled toggles envío", async () => {
      const off = await agent
        .put(`/api/v1/products/${productId}/listing`)
        .send({ shippingEnabled: false })
      expect(off.status).toBe(200)
      expect(off.body.listing?.shippingEnabled).toBe(false)

      const on = await agent
        .put(`/api/v1/products/${productId}/listing`)
        .send({ shippingEnabled: true })
      expect(on.status).toBe(200)
      expect(on.body.listing?.shippingEnabled).toBe(true)
    })

    it("PUT listing rejects internal POSTING", async () => {
      const res = await agent
        .put(`/api/v1/products/${productId}/listing`)
        .send({ status: "POSTING" })
      expect(res.status).toBe(400)
      expect(errorCode(res.body)).toBe("VALIDATION_ERROR")
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

      const list = await agent.get(
        `/api/v1/products?page=1&pageSize=50&q=${encodeURIComponent(sku)}`,
      )
      expect(list.status).toBe(200)
      const item = (list.body.products as Array<{
        sku?: string
        listingStatus?: string | null
        listingActive?: boolean
      }>).find((p) => p.sku === sku)
      expect(item?.listingStatus).toBe("ACTIVE")
      expect(item?.listingActive).toBe(true)
    })

    it("dry-run publish refuses already ACTIVE listing", async () => {
      const res = await agent
        .post(`/api/v1/products/${productId}/publish`)
        .send({ dryRun: true })
      expect(res.status).toBe(409)
      expect(errorCode(res.body)).toBe("ALREADY_POSTED")
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
      const item = res.body.products?.[0] as {
        listingActive?: boolean
        listingStatus?: string | null
      }
      expect(item?.listingStatus).toBe("DEACTIVATED")
      expect(item?.listingActive).toBe(false)
    })

    it("repeat POST sold returns 409 ALREADY_SOLD", async () => {
      const res = await agent.post(`/api/v1/products/${productId}/sold`)
      expect(res.status).toBe(409)
      expect(errorCode(res.body)).toBe("ALREADY_SOLD")
    })

    it("publish refuses SOLD product", async () => {
      const res = await agent
        .post(`/api/v1/products/${productId}/publish`)
        .send({ dryRun: true })
      expect(res.status).toBe(409)
      expect(errorCode(res.body)).toBe("NOT_PUBLISHABLE")
    })
  })

  describe("publish shipping gate", () => {
    it("live-path HTTP refuses missing peso before claim", async () => {
      const categoryId = await findLeafCategoryId(agent)
      const created = await agent.post("/api/v1/products").send({
        sku: `API-SHIP-${Date.now()}`,
        title: "API shipping incomplete",
        description: "Vitest SHIPPING_NOT_READY",
        price: 4.5,
        currency: "EUR",
        categoryId,
        condition: "GOOD",
        brand: "Acme",
      })
      expect(created.status).toBe(201)
      const id = created.body.product?.id as string
      expect(id).toBeTruthy()

      const png = await tinyPngBuffer()
      const photo = await agent
        .post(`/api/v1/products/${id}/images`)
        .attach("files", png, { filename: "test.png", contentType: "image/png" })
      expect(photo.status).toBe(201)

      const prev = process.env.WALLAPOP_PUBLISH_DRY_RUN
      process.env.WALLAPOP_PUBLISH_DRY_RUN = "false"
      try {
        const res = await agent.post(`/api/v1/products/${id}/publish`)
        expect(res.status).toBe(400)
        expect(errorCode(res.body)).toBe("SHIPPING_NOT_READY")
        const listing = await agent.get(`/api/v1/products/${id}/listing`)
        expect(listing.body.listing?.status).toBe("READY_TO_POST")
      } finally {
        if (prev === undefined) delete process.env.WALLAPOP_PUBLISH_DRY_RUN
        else process.env.WALLAPOP_PUBLISH_DRY_RUN = prev
        await agent.delete(`/api/v1/products/${id}`)
      }
    })
  })

  describe("publish claim (prisma)", () => {
    let claimProductId: string

    beforeAll(async () => {
      const categoryId = await findLeafCategoryId(agent)
      const res = await agent.post("/api/v1/products").send({
        sku: `API-CLAIM-${Date.now()}`,
        title: "API claim product",
        description: "Vitest publish claim",
        price: 4.5,
        currency: "EUR",
        categoryId,
        condition: "GOOD",
        brand: "Acme",
      })
      expect(res.status).toBe(201)
      claimProductId = res.body.product?.id as string
      expect(claimProductId).toBeTruthy()
    })

    it("listingBlocksDryRun allows POSTING but not ACTIVE or URL", () => {
      expect(
        listingBlocksDryRun({ status: "POSTING", externalUrl: null }),
      ).toBe(false)
      expect(
        listingBlocksDryRun({ status: "READY_TO_POST", externalUrl: null }),
      ).toBe(false)
      expect(
        listingBlocksDryRun({ status: "ACTIVE", externalUrl: null }),
      ).toBe(true)
      expect(
        listingBlocksDryRun({ status: "RESERVED", externalUrl: null }),
      ).toBe(true)
      expect(
        listingBlocksDryRun({
          status: "READY_TO_POST",
          externalUrl: "https://es.wallapop.com/item/x",
        }),
      ).toBe(true)
      expect(
        listingBlocksDryRun({
          status: "READY_TO_POST",
          externalUrl: "https://es.wallapop.com",
        }),
      ).toBe(false)
      expect(
        listingBlocksDryRun({
          status: "READY_TO_POST",
          externalUrl:
            "https://es.wallapop.com/app/catalog/upload/consumer-goods",
        }),
      ).toBe(false)
    })

    it("claims READY_TO_POST → POSTING and refuses a second claim", async () => {
      const prisma = getPrisma()
      expect(prisma).toBeTruthy()
      const accountId = await findDefaultAccountId(prisma!)
      expect(accountId).toBeTruthy()

      const claimed = await claimListingForPublish(
        prisma!,
        claimProductId,
        accountId!,
      )
      expect(claimed).toBe(true)

      const get = await agent.get(`/api/v1/products/${claimProductId}/listing`)
      expect(get.status).toBe(200)
      expect(get.body.listing?.status).toBe("POSTING")

      const again = await claimListingForPublish(
        prisma!,
        claimProductId,
        accountId!,
      )
      expect(again).toBe(false)
    })

    it("reverts POSTING → READY_TO_POST and does not revert ACTIVE", async () => {
      const prisma = getPrisma()
      expect(prisma).toBeTruthy()
      const accountId = await findDefaultAccountId(prisma!)
      expect(accountId).toBeTruthy()

      await revertPublishClaim(prisma!, claimProductId, accountId!)
      const afterRevert = await agent.get(
        `/api/v1/products/${claimProductId}/listing`,
      )
      expect(afterRevert.body.listing?.status).toBe("READY_TO_POST")

      const claimed = await claimListingForPublish(
        prisma!,
        claimProductId,
        accountId!,
      )
      expect(claimed).toBe(true)

      await prisma!.productListing.updateMany({
        where: { productId: claimProductId, accountId: accountId! },
        data: { status: "ACTIVE" },
      })
      await revertPublishClaim(prisma!, claimProductId, accountId!)
      const stillActive = await agent.get(
        `/api/v1/products/${claimProductId}/listing`,
      )
      expect(stillActive.body.listing?.status).toBe("ACTIVE")
    })

    it("live-path HTTP refuses already ACTIVE without opening Chrome", async () => {
      const prev = process.env.WALLAPOP_PUBLISH_DRY_RUN
      process.env.WALLAPOP_PUBLISH_DRY_RUN = "false"
      try {
        const res = await agent.post(
          `/api/v1/products/${claimProductId}/publish`,
        )
        expect(res.status).toBe(409)
        expect(errorCode(res.body)).toBe("ALREADY_POSTED")
      } finally {
        if (prev === undefined) delete process.env.WALLAPOP_PUBLISH_DRY_RUN
        else process.env.WALLAPOP_PUBLISH_DRY_RUN = prev
      }
    })

    it("shouldRevertPublishClaim only when claimed and Publicar was not clicked", () => {
      expect(shouldRevertPublishClaim(false, false)).toBe(false)
      expect(shouldRevertPublishClaim(true, false)).toBe(true)
      expect(shouldRevertPublishClaim(true, true)).toBe(false)
      expect(shouldRevertPublishClaim(false, true)).toBe(false)
      expect(shouldRevertPublishClaim(true, false, true)).toBe(false)
      expect(shouldRevertPublishClaim(true, true, true)).toBe(false)
      expect(shouldRevertPublishClaim(false, false, true)).toBe(false)
    })

    it("activatePostingListing writes ACTIVE only from POSTING", async () => {
      const prisma = getPrisma()
      expect(prisma).toBeTruthy()
      const accountId = await findDefaultAccountId(prisma!)
      expect(accountId).toBeTruthy()

      const categoryId = await findLeafCategoryId(agent)
      const created = await agent.post("/api/v1/products").send({
        sku: `API-ACTIVATE-${Date.now()}`,
        title: "API activate posting",
        description: "Vitest activatePostingListing",
        price: 5.5,
        currency: "EUR",
        categoryId,
        condition: "GOOD",
        brand: "Acme",
      })
      expect(created.status).toBe(201)
      const id = created.body.product?.id as string
      expect(id).toBeTruthy()

      try {
        const claimed = await claimListingForPublish(prisma!, id, accountId!)
        expect(claimed).toBe(true)

        const activated = await activatePostingListing(prisma!, id, accountId!, {
          externalUrl: "https://es.wallapop.com/item/test-activate",
          shippingEnabled: true,
        })
        expect(activated?.status).toBe("ACTIVE")
        expect(activated?.externalUrl).toBe(
          "https://es.wallapop.com/item/test-activate",
        )

        const get = await agent.get(`/api/v1/products/${id}/listing`)
        expect(get.body.listing?.status).toBe("ACTIVE")
        expect(get.body.listing?.externalUrl).toBe(
          "https://es.wallapop.com/item/test-activate",
        )
      } finally {
        await agent.delete(`/api/v1/products/${id}`)
      }
    })

    it("activatePostingListing fails without a public /item/ URL", async () => {
      const prisma = getPrisma()
      expect(prisma).toBeTruthy()
      const accountId = await findDefaultAccountId(prisma!)
      expect(accountId).toBeTruthy()

      const categoryId = await findLeafCategoryId(agent)
      const created = await agent.post("/api/v1/products").send({
        sku: `API-NOURL-${Date.now()}`,
        title: "API activate without item url",
        description: "Vitest activatePostingListing missing URL",
        price: 5.5,
        currency: "EUR",
        categoryId,
        condition: "GOOD",
        brand: "Acme",
      })
      expect(created.status).toBe(201)
      const id = created.body.product?.id as string
      expect(id).toBeTruthy()

      try {
        const claimed = await claimListingForPublish(prisma!, id, accountId!)
        expect(claimed).toBe(true)

        const activated = await activatePostingListing(prisma!, id, accountId!, {
          externalUrl: "https://es.wallapop.com/app/catalog/published",
          shippingEnabled: true,
        })
        expect(activated?.status).toBe("FAILED")
        expect(activated?.externalUrl).toBeNull()

        const get = await agent.get(`/api/v1/products/${id}/listing`)
        expect(get.body.listing?.status).toBe("FAILED")
        expect(get.body.listing?.externalUrl).toBeNull()
      } finally {
        await agent.delete(`/api/v1/products/${id}`)
      }
    })

    it("activatePostingListing does not clobber DEACTIVATED", async () => {
      const prisma = getPrisma()
      expect(prisma).toBeTruthy()
      const accountId = await findDefaultAccountId(prisma!)
      expect(accountId).toBeTruthy()

      const categoryId = await findLeafCategoryId(agent)
      const created = await agent.post("/api/v1/products").send({
        sku: `API-DEACT-${Date.now()}`,
        title: "API deactivate posting",
        description: "Vitest no clobber DEACTIVATED",
        price: 6.5,
        currency: "EUR",
        categoryId,
        condition: "GOOD",
        brand: "Acme",
      })
      expect(created.status).toBe(201)
      const id = created.body.product?.id as string
      expect(id).toBeTruthy()

      try {
        const claimed = await claimListingForPublish(prisma!, id, accountId!)
        expect(claimed).toBe(true)

        await prisma!.productListing.updateMany({
          where: { productId: id, accountId: accountId! },
          data: { status: "DEACTIVATED" },
        })

        const activated = await activatePostingListing(prisma!, id, accountId!, {
          externalUrl: "https://es.wallapop.com/item/should-not-write",
          shippingEnabled: true,
        })
        expect(activated).toBeNull()

        const get = await agent.get(`/api/v1/products/${id}/listing`)
        expect(get.body.listing?.status).toBe("DEACTIVATED")
        expect(get.body.listing?.externalUrl).toBeNull()
      } finally {
        await agent.delete(`/api/v1/products/${id}`)
      }
    })

    afterAll(async () => {
      if (!claimProductId || !agent) return
      await agent.delete(`/api/v1/products/${claimProductId}`)
    })
  })

  describe("PUT listing POSTING protection", () => {
    const createdIds: string[] = []

    async function createAndClaim() {
      const categoryId = await findLeafCategoryId(agent)
      const sku = `API-PUT-POSTING-${Date.now()}-${createdIds.length}`
      const created = await agent.post("/api/v1/products").send({
        sku,
        title: "API PUT posting protection",
        description: "Vitest PUT while POSTING",
        price: 7.5,
        currency: "EUR",
        categoryId,
        condition: "GOOD",
        brand: "Acme",
      })
      expect(created.status).toBe(201)
      const id = created.body.product?.id as string
      expect(id).toBeTruthy()
      createdIds.push(id)

      const prisma = getPrisma()
      expect(prisma).toBeTruthy()
      const accountId = await findDefaultAccountId(prisma!)
      expect(accountId).toBeTruthy()
      const claimed = await claimListingForPublish(prisma!, id, accountId!)
      expect(claimed).toBe(true)
      return { id, sku }
    }

    it("list shows POSTING and listingActive false; PUT READY_TO_POST 409; URL-only and ACTIVE recovery ok", async () => {
      const { id, sku } = await createAndClaim()

      const list = await agent.get(
        `/api/v1/products?page=1&pageSize=50&q=${encodeURIComponent(sku)}`,
      )
      expect(list.status).toBe(200)
      const item = (list.body.products as Array<{
        sku?: string
        listingStatus?: string | null
        listingActive?: boolean
      }>).find((p) => p.sku === sku)
      expect(item?.listingStatus).toBe("POSTING")
      expect(item?.listingActive).toBe(false)

      const rejected = await agent
        .put(`/api/v1/products/${id}/listing`)
        .send({ status: "READY_TO_POST" })
      expect(rejected.status).toBe(409)
      expect(errorCode(rejected.body)).toBe("PUBLISH_IN_PROGRESS")
      const stillPosting = await agent.get(`/api/v1/products/${id}/listing`)
      expect(stillPosting.body.listing?.status).toBe("POSTING")

      const url = "https://es.wallapop.com/item/posting-url-only"
      const urlOnly = await agent
        .put(`/api/v1/products/${id}/listing`)
        .send({ externalUrl: url })
      expect(urlOnly.status).toBe(200)
      expect(urlOnly.body.listing?.status).toBe("POSTING")
      expect(urlOnly.body.listing?.externalUrl).toBe(url)

      const recovered = await agent
        .put(`/api/v1/products/${id}/listing`)
        .send({ status: "ACTIVE" })
      expect(recovered.status).toBe(200)
      expect(recovered.body.listing?.status).toBe("ACTIVE")
    })

    it("PUT DEACTIVATED while POSTING is allowed", async () => {
      const { id } = await createAndClaim()
      const res = await agent
        .put(`/api/v1/products/${id}/listing`)
        .send({ status: "DEACTIVATED" })
      expect(res.status).toBe(200)
      expect(res.body.listing?.status).toBe("DEACTIVATED")
    })

    it("PUT RESERVED while POSTING is allowed", async () => {
      const { id } = await createAndClaim()
      const res = await agent
        .put(`/api/v1/products/${id}/listing`)
        .send({ status: "RESERVED" })
      expect(res.status).toBe(200)
      expect(res.body.listing?.status).toBe("RESERVED")
    })

    afterAll(async () => {
      if (!agent) return
      for (const id of createdIds) {
        await agent.delete(`/api/v1/products/${id}`)
      }
    })
  })

  describe("listing RESERVED", () => {
    let reservedProductId: string
    let reservedSku: string

    beforeAll(async () => {
      const categoryId = await findLeafCategoryId(agent)
      reservedSku = `API-RESERVED-${Date.now()}`
      const created = await agent.post("/api/v1/products").send({
        sku: reservedSku,
        title: "API reserved listing",
        description: "Vitest RESERVED listing status",
        price: 8.5,
        currency: "EUR",
        categoryId,
        condition: "GOOD",
        brand: "Acme",
        weightKg: 1.2,
      })
      expect(created.status).toBe(201)
      reservedProductId = created.body.product?.id as string
      expect(reservedProductId).toBeTruthy()

      const put = await agent
        .put(`/api/v1/products/${reservedProductId}/listing`)
        .send({
          status: "RESERVED",
          externalUrl: "https://es.wallapop.com/item/api-reserved",
        })
      expect(put.status).toBe(200)
      expect(put.body.listing?.status).toBe("RESERVED")
    })

    afterAll(async () => {
      if (reservedProductId && agent) {
        await agent.delete(`/api/v1/products/${reservedProductId}`)
      }
    })

    it("lists listingActive true and does not publish or claim", async () => {
      const list = await agent.get(
        `/api/v1/products?page=1&pageSize=50&q=${encodeURIComponent(reservedSku)}`,
      )
      expect(list.status).toBe(200)
      const item = (
        list.body.products as Array<{
          sku?: string
          status?: string
          listingStatus?: string | null
          listingActive?: boolean
        }>
      ).find((p) => p.sku === reservedSku)
      expect(item?.status).toBe("ACTIVE")
      expect(item?.listingStatus).toBe("RESERVED")
      expect(item?.listingActive).toBe(true)

      const publish = await agent
        .post(`/api/v1/products/${reservedProductId}/publish`)
        .send({ dryRun: true })
      expect(publish.status).toBe(409)
      expect(errorCode(publish.body)).toBe("ALREADY_POSTED")

      const prisma = getPrisma()
      expect(prisma).toBeTruthy()
      const accountId = await findDefaultAccountId(prisma!)
      expect(accountId).toBeTruthy()
      const claimed = await claimListingForPublish(
        prisma!,
        reservedProductId,
        accountId!,
      )
      expect(claimed).toBe(false)
    })

    it("POST sold deactivates a RESERVED listing", async () => {
      const res = await agent.post(`/api/v1/products/${reservedProductId}/sold`)
      expect(res.status).toBe(200)
      expect(res.body.product?.status).toBe("SOLD")
      expect(res.body.product?.listing?.status).toBe("DEACTIVATED")

      const list = await agent.get(
        `/api/v1/products?page=1&pageSize=50&q=${encodeURIComponent(reservedSku)}`,
      )
      const item = (
        list.body.products as Array<{
          sku?: string
          listingStatus?: string | null
          listingActive?: boolean
        }>
      ).find((p) => p.sku === reservedSku)
      expect(item?.listingStatus).toBe("DEACTIVATED")
      expect(item?.listingActive).toBe(false)
    })
  })

  describe("wallapop eliminar (CRM side)", () => {
    it("deactivates the listing, clears the URL, keeps the warehouse, then re-queues", async () => {
      const categoryId = await findLeafCategoryId(agent)
      const created = await agent.post("/api/v1/products").send({
        sku: `API-ELIM-${Date.now()}`,
        title: "API eliminar listing",
        description: "Vitest eliminar DEACTIVATED",
        price: 9.5,
        currency: "EUR",
        categoryId,
        condition: "GOOD",
        brand: "Acme",
        weightKg: 1.2,
      })
      expect(created.status).toBe(201)
      const id = created.body.product?.id as string
      try {
        const put = await agent.put(`/api/v1/products/${id}/listing`).send({
          status: "ACTIVE",
          externalUrl: "https://es.wallapop.com/item/api-eliminar-1234567890",
        })
        expect(put.status).toBe(200)

        const blocked = await agent.delete(`/api/v1/products/${id}`)
        expect(blocked.status).toBe(409)
        expect(errorCode(blocked.body)).toBe("STILL_ON_WALLAPOP")

        const count = await deactivateListingAfterEliminar(getPrisma()!, id)
        expect(count).toBe(1)

        const get = await agent.get(`/api/v1/products/${id}`)
        expect(get.body.product?.status).toBe("ACTIVE")
        expect(get.body.product?.listing?.status).toBe("DEACTIVATED")
        expect(get.body.product?.listing?.externalUrl).toBeNull()

        const again = await agent
          .post(`/api/v1/products/${id}/wallapop-eliminar`)
          .send({ dryRun: true })
        expect(again.status).toBe(409)
        expect(errorCode(again.body)).toBe("LISTING_NOT_ACTIVE")

        const requeue = await agent
          .put(`/api/v1/products/${id}/listing`)
          .send({ status: "READY_TO_POST", externalUrl: null })
        expect(requeue.status).toBe(200)
        expect(requeue.body.listing?.status).toBe("READY_TO_POST")

        const removed = await agent.post(`/api/v1/products/${id}/catalog-delete`).send({})
        expect(removed.status).toBe(200)
        expect(removed.body.deleted).toBe(true)
      } finally {
        await agent.delete(`/api/v1/products/${id}`)
      }
    })
  })

  describe("wallapop devolución", () => {
    it("keeps warehouse SOLD after eliminar CRM, then requeues the same SKU", async () => {
      const categoryId = await findLeafCategoryId(agent)
      const sku = `API-DEVOL-${Date.now()}`
      const created = await agent.post("/api/v1/products").send({
        sku,
        title: "API devolución listing",
        description: "Vitest devolución READY_TO_POST",
        price: 11,
        currency: "EUR",
        categoryId,
        condition: "GOOD",
        brand: "Acme",
        weightKg: 1.2,
      })
      expect(created.status).toBe(201)
      const id = created.body.product?.id as string
      try {
        const put = await agent.put(`/api/v1/products/${id}/listing`).send({
          status: "ACTIVE",
          externalUrl: "https://es.wallapop.com/item/api-devolucion-1234567890",
        })
        expect(put.status).toBe(200)

        const sold = await agent.post(`/api/v1/products/${id}/sold`)
        expect(sold.status).toBe(200)
        expect(sold.body.product?.status).toBe("SOLD")
        expect(sold.body.product?.listing?.status).toBe("DEACTIVATED")
        expect(sold.body.product?.listing?.externalUrl).toBe(
          "https://es.wallapop.com/item/api-devolucion-1234567890",
        )

        const blocked = await agent
          .post(`/api/v1/products/${id}/wallapop-eliminar`)
          .send({ dryRun: true })
        expect(blocked.status).toBe(409)
        expect(errorCode(blocked.body)).toBe("ALREADY_SOLD")

        const count = await deactivateListingAfterEliminar(getPrisma()!, id)
        expect(count).toBe(1)
        const afterEliminar = await agent.get(`/api/v1/products/${id}`)
        expect(afterEliminar.body.product?.status).toBe("SOLD")
        expect(afterEliminar.body.product?.listing?.status).toBe("DEACTIVATED")
        expect(afterEliminar.body.product?.listing?.externalUrl).toBeNull()

        const listingPut = await agent
          .put(`/api/v1/products/${id}/listing`)
          .send({ status: "READY_TO_POST", externalUrl: null })
        expect(listingPut.status).toBe(200)
        expect(listingPut.body.listing?.status).toBe("READY_TO_POST")
        const stillSold = await agent.get(`/api/v1/products/${id}`)
        expect(stillSold.body.product?.status).toBe("SOLD")

        const devolucion = await agent
          .post(`/api/v1/products/${id}/wallapop-devolucion`)
          .send({})
        expect(devolucion.status).toBe(200)
        expect(devolucion.body.step).toBe("requeued")
        expect(devolucion.body.eliminated).toBe(false)
        expect(devolucion.body.product?.status).toBe("ACTIVE")
        expect(devolucion.body.product?.soldAt).toBeNull()
        expect(devolucion.body.product?.listing?.status).toBe("READY_TO_POST")
        expect(devolucion.body.product?.sku).toBe(sku)
      } finally {
        await agent.delete(`/api/v1/products/${id}`)
      }
    })

    it("POST devolución without /item/ URL returns the same SKU to cola", async () => {
      const categoryId = await findLeafCategoryId(agent)
      const created = await agent.post("/api/v1/products").send({
        sku: `API-DEVOL2-${Date.now()}`,
        title: "API devolución cola",
        description: "Vitest devolución HTTP",
        price: 8,
        currency: "EUR",
        categoryId,
        condition: "GOOD",
        brand: "Acme",
        weightKg: 0.8,
      })
      expect(created.status).toBe(201)
      const id = created.body.product?.id as string
      try {
        const sold = await agent.post(`/api/v1/products/${id}/sold`)
        expect(sold.status).toBe(200)
        expect(sold.body.product?.status).toBe("SOLD")

        const devolucion = await agent
          .post(`/api/v1/products/${id}/wallapop-devolucion`)
          .send({})
        expect(devolucion.status).toBe(200)
        expect(devolucion.body.ok).toBe(true)
        expect(devolucion.body.dryRun).toBe(false)
        expect(devolucion.body.step).toBe("requeued")
        expect(devolucion.body.eliminated).toBe(false)
        expect(devolucion.body.product?.status).toBe("ACTIVE")
        expect(devolucion.body.product?.soldAt).toBeNull()
        expect(devolucion.body.product?.listing?.status).toBe("READY_TO_POST")
        expect(devolucion.body.product?.listing?.externalUrl).toBeNull()
        expect(devolucion.body.product?.sku).toBe(created.body.product?.sku)
      } finally {
        await agent.delete(`/api/v1/products/${id}`)
      }
    })
  })

  describe("wallapop identity reset", () => {
    let id: string
    let previousEmail: string | null = null

    beforeAll(async () => {
      const prisma = getPrisma()
      const account = await prisma?.account.findFirst({
        where: { isDefault: true },
        select: { wallapopEmail: true },
      })
      previousEmail = account?.wallapopEmail ?? null

      const categoryId = await findLeafCategoryId(agent)
      const sku = `ID-RESET-${Date.now()}`
      const created = await agent.post("/api/v1/products").send({
        sku,
        title: "Identity reset product",
        description: "Listing reset when Wallapop email changes",
        price: 3,
        currency: "EUR",
        categoryId,
        condition: "GOOD",
        brand: "Acme",
      })
      expect(created.status).toBe(201)
      id = created.body.product?.id as string
    })

    afterAll(async () => {
      if (id && agent) await agent.delete(`/api/v1/products/${id}`)
      const prisma = getPrisma()
      if (!prisma) return
      await prisma.account.updateMany({
        where: { isDefault: true },
        data: { wallapopEmail: previousEmail },
      })
    })

    it("resets listings when the Wallapop email changes", async () => {
      const prisma = getPrisma()
      expect(prisma).toBeTruthy()
      if (!prisma) return

      const posted = await agent.put(`/api/v1/products/${id}/listing`).send({
        status: "ACTIVE",
        externalUrl: "https://es.wallapop.com/item/identity-reset",
      })
      expect(posted.status).toBe(200)
      expect(posted.body.listing).toHaveProperty("lastPostedAt")
      expect(posted.body.listing?.status).toBe("ACTIVE")

      await syncWallapopIdentityOnActive(prisma, "first-identity@example.com")
      const same = await agent.get(`/api/v1/products/${id}/listing`)
      expect(same.body.listing?.status).toBe("ACTIVE")
      expect(same.body.listing?.externalUrl).toBe(
        "https://es.wallapop.com/item/identity-reset",
      )

      await syncWallapopIdentityOnActive(prisma, "second-identity@example.com")
      const reset = await agent.get(`/api/v1/products/${id}/listing`)
      expect(reset.body.listing?.status).toBe("READY_TO_POST")
      expect(reset.body.listing?.externalUrl).toBeNull()
      expect(reset.body.listing?.lastPostedAt).toBeNull()

      const account = await prisma.account.findFirst({
        where: { isDefault: true },
        select: { autopostEnabled: true, wallapopEmail: true },
      })
      expect(account?.autopostEnabled).toBe(false)
      expect(account?.wallapopEmail).toBe("second-identity@example.com")
    })
  })

  describe("sold keeps other accounts", () => {
    it("deactivates only the default listing and stores who sold", async () => {
      const prisma = getPrisma()
      expect(prisma).toBeTruthy()
      if (!prisma) return
      const sellerId = await findDefaultAccountId(prisma)
      expect(sellerId).toBeTruthy()
      const categoryId = await findLeafCategoryId(agent)
      const sku = `API-SOLD-ACCT-${Date.now()}`
      const created = await agent.post("/api/v1/products").send({
        sku,
        title: "Sold account scope",
        description: "Neighbor listings stay live",
        price: 12,
        currency: "EUR",
        categoryId,
        condition: "GOOD",
        brand: "Acme",
      })
      expect(created.status).toBe(201)
      const id = created.body.product?.id as string
      const neighborIds: string[] = []
      try {
        const put = await agent.put(`/api/v1/products/${id}/listing`).send({
          status: "ACTIVE",
          externalUrl: "https://es.wallapop.com/item/sold-account-seller",
        })
        expect(put.status).toBe(200)

        const neighbors = [
          {
            name: `Norte ${sku}`,
            status: "ACTIVE" as const,
            externalUrl: "https://es.wallapop.com/item/sold-account-norte",
          },
          {
            name: `Sur ${sku}`,
            status: "RESERVED" as const,
            externalUrl: "https://es.wallapop.com/item/sold-account-sur",
          },
          {
            name: `Este ${sku}`,
            status: "POSTING" as const,
            externalUrl: null,
          },
        ]
        for (const neighbor of neighbors) {
          const account = await createSideAccount(neighbor.name)
          neighborIds.push(account.id)
          await prisma.productListing.create({
            data: {
              productId: id,
              accountId: account.id,
              status: neighbor.status,
              externalUrl: neighbor.externalUrl,
            },
          })
        }

        const sold = await agent.post(`/api/v1/products/${id}/sold`)
        expect(sold.status).toBe(200)
        expect(sold.body.product?.status).toBe("SOLD")
        expect(sold.body.product?.listing?.status).toBe("DEACTIVATED")

        const row = await prisma.product.findUnique({
          where: { id },
          select: {
            soldAccountId: true,
            listings: {
              select: { accountId: true, status: true, externalUrl: true },
            },
          },
        })
        expect(row?.soldAccountId).toBe(sellerId)
        const byAccount = new Map(
          row?.listings.map((listing) => [listing.accountId, listing]),
        )
        expect(byAccount.get(sellerId!)?.status).toBe("DEACTIVATED")
        expect(byAccount.get(sellerId!)?.externalUrl).toBe(
          "https://es.wallapop.com/item/sold-account-seller",
        )
        expect(byAccount.get(neighborIds[0])?.status).toBe("ACTIVE")
        expect(byAccount.get(neighborIds[1])?.status).toBe("RESERVED")
        expect(byAccount.get(neighborIds[2])?.status).toBe("POSTING")
      } finally {
        await prisma.product.delete({ where: { id } }).catch(() => undefined)
        if (neighborIds.length > 0) {
          await prisma.account.deleteMany({ where: { id: { in: neighborIds } } })
        }
      }
    })

    it("requeues the seller and every taken-down account", async () => {
      const prisma = getPrisma()
      expect(prisma).toBeTruthy()
      if (!prisma) return
      const sellerId = await findDefaultAccountId(prisma)
      expect(sellerId).toBeTruthy()
      const categoryId = await findLeafCategoryId(agent)
      const sku = `API-SOLD-REQUEUE-${Date.now()}`
      const created = await agent.post("/api/v1/products").send({
        sku,
        title: "Sold requeue account",
        description: "Return requeues taken-down accounts",
        price: 14,
        currency: "EUR",
        categoryId,
        condition: "GOOD",
        brand: "Acme",
      })
      expect(created.status).toBe(201)
      const id = created.body.product?.id as string
      let neighborId = ""
      let takenDownId = ""
      try {
        const put = await agent.put(`/api/v1/products/${id}/listing`).send({
          status: "ACTIVE",
          externalUrl: "https://es.wallapop.com/item/sold-requeue-default",
        })
        expect(put.status).toBe(200)
        const account = await createSideAccount(`Vendedor ${sku}`)
        neighborId = account.id
        await prisma.productListing.create({
          data: {
            productId: id,
            accountId: neighborId,
            status: "ACTIVE",
            externalUrl: "https://es.wallapop.com/item/sold-requeue-neighbor",
          },
        })

        const sold = await markProductSoldTx(prisma, id, { accountId: neighborId })
        expect(sold.kind).toBe("ok")

        const afterSold = await prisma.product.findUnique({
          where: { id },
          select: {
            status: true,
            soldAccountId: true,
            listings: { select: { accountId: true, status: true } },
          },
        })
        expect(afterSold?.status).toBe("SOLD")
        expect(afterSold?.soldAccountId).toBe(neighborId)
        const soldByAccount = new Map(
          afterSold?.listings.map((listing) => [listing.accountId, listing.status]),
        )
        expect(soldByAccount.get(sellerId!)).toBe("ACTIVE")
        expect(soldByAccount.get(neighborId)).toBe("DEACTIVATED")

        const takenDown = await createSideAccount(`Retirada ${sku}`)
        takenDownId = takenDown.id
        await prisma.productListing.create({
          data: {
            productId: id,
            accountId: takenDownId,
            status: "DEACTIVATED",
            externalUrl: null,
          },
        })

        const requeued = await requeueSoldProductAfterReturn(prisma, id)
        expect(requeued.kind).toBe("ok")
        const afterReturn = await prisma.product.findUnique({
          where: { id },
          select: {
            status: true,
            soldAccountId: true,
            soldAt: true,
            listings: {
              select: { accountId: true, status: true, externalUrl: true },
            },
          },
        })
        expect(afterReturn?.status).toBe("ACTIVE")
        expect(afterReturn?.soldAccountId).toBeNull()
        expect(afterReturn?.soldAt).toBeNull()
        const returned = new Map(
          afterReturn?.listings.map((listing) => [listing.accountId, listing]),
        )
        expect(returned.get(sellerId!)?.status).toBe("ACTIVE")
        expect(returned.get(sellerId!)?.externalUrl).toBe(
          "https://es.wallapop.com/item/sold-requeue-default",
        )
        expect(returned.get(neighborId)?.status).toBe("READY_TO_POST")
        expect(returned.get(neighborId)?.externalUrl).toBeNull()
        expect(returned.get(takenDownId)?.status).toBe("READY_TO_POST")
        expect(returned.get(takenDownId)?.externalUrl).toBeNull()
      } finally {
        await prisma.product.delete({ where: { id } }).catch(() => undefined)
        const accountIds = [neighborId, takenDownId].filter(Boolean)
        if (accountIds.length > 0) {
          await prisma.account.deleteMany({ where: { id: { in: accountIds } } })
        }
      }
    })
  })

  describe("account cards", () => {
    it("creates an account row and no publication queue", async () => {
      const prisma = getPrisma()
      expect(prisma).toBeTruthy()
      if (!prisma) return
      const before = await prisma.productListing.count()
      const created = await agent.post("/api/v1/accounts").send({
        name: `Sur pantalla ${Date.now()}`,
        isDefault: true,
      })
      const id = created.body.account?.id as string | undefined
      try {
        expect(created.status).toBe(201)
        expect(created.body.account?.isDefault).toBe(false)
        expect(await prisma.productListing.count()).toBe(before)
        const listed = await agent.get("/api/v1/accounts")
        expect(listed.status).toBe(200)
        const row = (
          listed.body.accounts as { id: string; isDefault: boolean }[]
        ).find((account) => account.id === id)
        expect(row?.isDefault).toBe(false)
      } finally {
        if (id) {
          await prisma.account.delete({ where: { id } }).catch(() => undefined)
        }
      }
    })

    it("returns every stored listing on the product", async () => {
      const prisma = getPrisma()
      expect(prisma).toBeTruthy()
      if (!prisma) return
      const sellerId = await findDefaultAccountId(prisma)
      expect(sellerId).toBeTruthy()
      const categoryId = await findLeafCategoryId(agent)
      const created = await agent.post("/api/v1/products").send({
        sku: `API-LISTINGS-${Date.now()}`,
        title: "Listing blocks",
        description: "One SKU, one row per account",
        price: 11,
        currency: "EUR",
        categoryId,
        condition: "GOOD",
        brand: "Acme",
      })
      expect(created.status).toBe(201)
      const id = created.body.product?.id as string
      const neighbor = await createSideAccount("Sur bloque")
      try {
        await prisma.productListing.create({
          data: {
            productId: id,
            accountId: neighbor.id,
            status: "ACTIVE",
            externalUrl: "https://es.wallapop.com/item/sur-bloque",
          },
        })
        const loaded = await agent.get(`/api/v1/products/${id}`)
        expect(loaded.status).toBe(200)
        expect(loaded.body.product?.listing?.accountId).toBe(sellerId)
        const listings = loaded.body.product?.listings as {
          accountId: string
          accountName: string
        }[]
        expect(listings).toHaveLength(2)
        expect(listings[0]?.accountId).toBe(sellerId)
        expect(listings.some((row) => row.accountId === neighbor.id)).toBe(true)
        expect(
          listings.find((row) => row.accountId === neighbor.id)?.accountName,
        ).toBe("Sur bloque")
      } finally {
        await prisma.product.delete({ where: { id } }).catch(() => undefined)
        await prisma.account
          .delete({ where: { id: neighbor.id } })
          .catch(() => undefined)
      }
    })

    it("looks up a missing product even when the button names another account", async () => {
      const prisma = getPrisma()
      expect(prisma).toBeTruthy()
      if (!prisma) return
      const neighbor = await createSideAccount("Sur chrome")
      try {
        for (const path of [
          "/api/v1/products/missing-product/wallapop-sold",
          "/api/v1/products/missing-product/wallapop-eliminar",
          "/api/v1/products/missing-product/wallapop-devolucion",
        ]) {
          const res = await agent.post(path).send({ accountId: neighbor.id })
          expect(res.status).toBe(404)
          expect(errorCode(res.body)).toBe("NOT_FOUND")
        }
      } finally {
        await prisma.account
          .delete({ where: { id: neighbor.id } })
          .catch(() => undefined)
      }
    })
  })

  afterAll(async () => {
    if (!productId || !agent) return
    await agent.delete(`/api/v1/products/${productId}`)
  })
})
