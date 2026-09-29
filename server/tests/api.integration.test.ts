import type { Express } from "express"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import request from "supertest"

import { createApp } from "../src/app"
import { getPrisma } from "../src/lib/db"
import { findDefaultAccountId } from "../src/lib/default-account"
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
        listingBlocksDryRun({
          status: "READY_TO_POST",
          externalUrl: "https://es.wallapop.com/item/x",
        }),
      ).toBe(true)
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

    afterAll(async () => {
      if (!agent) return
      for (const id of createdIds) {
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

  afterAll(async () => {
    if (!productId || !agent) return
    await agent.delete(`/api/v1/products/${productId}`)
  })
})
