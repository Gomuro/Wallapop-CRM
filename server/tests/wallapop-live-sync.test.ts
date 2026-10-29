import type { Express } from "express"
import type request from "supertest"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { createApp } from "../src/app"
import { getPrisma } from "../src/lib/db"
import { resetSellerUserIdCacheForTests } from "../src/lib/wallapop-already-live"
import type { CrmLiveRow, LiveMark } from "../src/lib/wallapop-live-mark"
import { liveSyncMode, planLiveSync, runLiveSync } from "../src/lib/wallapop-live-sync"
import { findLeafCategoryId, login, seedCredentials } from "./helpers"

function row(partial: Partial<CrmLiveRow> & Pick<CrmLiveRow, "listingId" | "sku" | "title">): CrmLiveRow {
  return { price: 44.95, productStatus: "ACTIVE", listingStatus: "FAILED", externalUrl: null, ...partial }
}

function hanging(listingId: string, href: string, reason: "title" | "stored_url" = "title"): LiveMark {
  return { action: "hanging", listingId, sku: listingId, status: "ACTIVE", externalUrl: href, reason }
}

describe("planLiveSync", () => {
  it("links queued rows only and leaves live, posting and sold rows alone", () => {
    const rows = [
      row({ listingId: "failed", sku: "1", title: "Kit de embrague SEAT Ibiza" }),
      row({ listingId: "ready", sku: "2", title: "Medidor de gas", listingStatus: "READY_TO_POST" }),
      row({ listingId: "active", sku: "3", title: "Sartén", listingStatus: "ACTIVE" }),
    ]
    const plan = planLiveSync({
      rows,
      marks: [hanging("failed", "https://es.wallapop.com/item/a-1"), hanging("ready", "https://es.wallapop.com/item/b-2"), hanging("active", "https://es.wallapop.com/item/c-3")],
    })
    expect(plan.link.map((entry) => entry.row.sku)).toEqual(["1", "2"])
    expect(plan.ambiguous).toEqual([])
  })

  it("only reports a title match when another product has the same title and price", () => {
    const rows = [
      row({ listingId: "twin-live", sku: "WP-276279", title: "LIONELO Parque infantil", listingStatus: "ACTIVE" }),
      row({ listingId: "twin-failed", sku: "WP-715753", title: "LIONELO  Parque infantil" }),
    ]
    const plan = planLiveSync({ rows, marks: [hanging("twin-failed", "https://es.wallapop.com/item/lionelo-2")] })
    expect(plan.link).toEqual([])
    expect(plan.ambiguous).toMatchObject([{ row: { sku: "WP-715753" }, why: "twin_product" }])
  })

  it("trusts the stored link even for a twin, and reports several fitting ads", () => {
    const rows = [
      row({ listingId: "a", sku: "A", title: "Termo Ariston" }),
      row({ listingId: "b", sku: "B", title: "Termo Ariston" }),
    ]
    const plan = planLiveSync({
      rows,
      marks: [
        hanging("a", "https://es.wallapop.com/item/termo-1", "stored_url"),
        { action: "leave", listingId: "b", sku: "B", reason: "ambiguous" },
      ],
    })
    expect(plan.link.map((entry) => entry.row.sku)).toEqual(["A"])
    expect(plan.ambiguous).toMatchObject([{ row: { sku: "B" }, why: "several_live" }])
  })
})

describe("liveSyncMode", () => {
  afterEach(() => {
    delete process.env.WALLAPOP_LIVE_SYNC
  })

  it("only reports unless write is set", () => {
    expect(liveSyncMode()).toBe("preview")
    process.env.WALLAPOP_LIVE_SYNC = "WRITE"
    expect(liveSyncMode()).toBe("write")
    process.env.WALLAPOP_LIVE_SYNC = "off"
    expect(liveSyncMode()).toBe("off")
    process.env.WALLAPOP_LIVE_SYNC = "yes"
    expect(liveSyncMode()).toBe("preview")
  })
})

describe("runLiveSync against the public profile", () => {
  const stamp = Date.now()
  const SELLER = "livesynctest"
  const titles = { single: `Volante bimasa test ${stamp}`, twin: `Parque infantil test ${stamp}` }
  const href = (slug: string) => `https://es.wallapop.com/item/${slug}`
  let app: Express
  let agent: request.Agent
  let defaultAccountId = ""
  let storedSellerId: string | null = null
  const productIds: string[] = []
  const listing: Record<string, string> = {}
  const offline = process.env.WALLAPOP_OFFLINE

  function prisma() {
    const client = getPrisma()
    if (!client) throw new Error("Database is not configured.")
    return client
  }

  async function product(key: string, title: string, status: "FAILED" | "ACTIVE", externalUrl: string | null) {
    const categoryId = await findLeafCategoryId(agent)
    const created = await agent.post("/api/v1/products").send({
      sku: `API-LIVESYNC-${key}-${stamp}`,
      title,
      description: "Producto de prueba para la doble verificación del perfil público.",
      price: 44.95,
      currency: "EUR",
      categoryId,
      condition: "NEW",
    })
    expect(created.status).toBe(201)
    const productId = created.body.product?.id as string
    productIds.push(productId)
    const saved = await prisma().productListing.upsert({
      where: { productId_accountId: { productId, accountId: defaultAccountId } },
      create: { productId, accountId: defaultAccountId, status, externalUrl },
      update: { status, externalUrl, postingAttempts: 1, lastPublishError: "Tras Publicar no se obtuvo el enlace" },
      select: { id: true },
    })
    listing[key] = saved.id
  }

  beforeAll(async () => {
    app = createApp()
    const { email, password } = seedCredentials()
    const loggedIn = await login(app, email, password)
    if (loggedIn.res.status !== 200) throw new Error(`login failed: ${loggedIn.res.status}`)
    agent = loggedIn.agent
    const account = await prisma().account.findFirst({
      where: { isDefault: true },
      select: { id: true, wallapopUserId: true },
    })
    if (!account) throw new Error("no default account")
    defaultAccountId = account.id
    storedSellerId = account.wallapopUserId
    await prisma().account.update({ where: { id: account.id }, data: { wallapopUserId: SELLER } })
    await product("single", titles.single, "FAILED", null)
    await product("twinLive", titles.twin, "ACTIVE", href(`parque-infantil-${stamp}-1`))
    await product("twinFailed", titles.twin, "FAILED", null)
    const items = [
      { slug: `volante-bimasa-${stamp}`, title: titles.single },
      { slug: `parque-infantil-${stamp}-1`, title: titles.twin },
      { slug: `parque-infantil-${stamp}-2`, title: titles.twin },
    ].map((item, index) => ({ id: `id${index}`, ...item, price: { amount: 44.95 }, isReserved: false }))
    vi.stubGlobal("fetch", async (url: URL | string) => {
      if (!String(url).includes(`/api/v3/users/${SELLER}/items`)) throw new Error(`unexpected fetch ${String(url)}`)
      return new Response(JSON.stringify({ data: items, meta: {} }), { status: 200 })
    })
    process.env.WALLAPOP_OFFLINE = "0"
    resetSellerUserIdCacheForTests()
  })

  afterAll(async () => {
    vi.unstubAllGlobals()
    process.env.WALLAPOP_OFFLINE = offline
    resetSellerUserIdCacheForTests()
    await prisma().account.update({ where: { id: defaultAccountId }, data: { wallapopUserId: storedSellerId } })
    for (const id of productIds) await agent.delete(`/api/v1/products/${id}`)
  })

  async function statusOf(key: string) {
    return prisma().productListing.findUnique({
      where: { id: listing[key] },
      select: { status: true, externalUrl: true, postingAttempts: true, lastPublishError: true },
    })
  }

  it("preview writes nothing", async () => {
    const result = await runLiveSync(prisma(), "preview")
    expect(result).toMatchObject({ linked: 0 })
    expect(result?.planned).toBeGreaterThanOrEqual(1)
    expect(await statusOf("single")).toMatchObject({ status: "FAILED", externalUrl: null })
  })

  it("write links the single match and leaves the twin product for a person", async () => {
    const result = await runLiveSync(prisma(), "write")
    expect(result?.linked).toBeGreaterThanOrEqual(1)
    expect(await statusOf("single")).toEqual({
      status: "ACTIVE",
      externalUrl: href(`volante-bimasa-${stamp}`),
      postingAttempts: 0,
      lastPublishError: null,
    })
    expect(await statusOf("twinFailed")).toMatchObject({ status: "FAILED", externalUrl: null })
  })

  it("does nothing while offline", async () => {
    process.env.WALLAPOP_OFFLINE = "1"
    expect(await runLiveSync(prisma(), "write")).toBeNull()
    process.env.WALLAPOP_OFFLINE = "0"
  })
})
