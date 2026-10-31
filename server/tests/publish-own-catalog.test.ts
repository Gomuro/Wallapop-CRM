import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const spies = vi.hoisted(() => ({
  claim: vi.fn(),
  execute: vi.fn(),
  adoptDefault: vi.fn(),
  logs: [] as Array<{ level: string; msg: string; data?: Record<string, unknown> }>,
}))

vi.mock("../src/lib/log", async (original) => ({
  ...(await original<typeof import("../src/lib/log")>()),
  log: (level: string, msg: string, data?: Record<string, unknown>) => {
    spies.logs.push({ level, msg, data })
  },
}))

vi.mock("../src/routes/product-publish-run", async (original) => ({
  ...(await original<typeof import("../src/routes/product-publish-run")>()),
  claimLivePublish: spies.claim,
  executeLivePublish: spies.execute,
}))

vi.mock("../src/lib/wallapop-already-live", async (original) => ({
  ...(await original<typeof import("../src/lib/wallapop-already-live")>()),
  adoptAlreadyLiveBeforePublish: spies.adoptDefault,
}))

vi.mock("../src/lib/default-account", async (original) => ({
  ...(await original<typeof import("../src/lib/default-account")>()),
  findDefaultAccountId: async () => "acc-pro",
}))

const prepared = vi.hoisted(() => ({ value: null as unknown }))

vi.mock("../src/routes/product-publish-prepare", async (original) => ({
  ...(await original<typeof import("../src/routes/product-publish-prepare")>()),
  prepareProductPublish: async () => prepared.value,
}))

import { resetSellerUserIdCacheForTests } from "../src/lib/wallapop-already-live"
import { runProductPublish } from "../src/routes/product-publish"

const W2 = "acc-w2"
const LUK_URL = "https://es.wallapop.com/item/juego-embrague-luk-600001700-dmf-1318912350"

type FakeListing = {
  id: string
  accountId: string
  status: string
  externalUrl: string | null
  variantTitle: string | null
  variantPrice: number | null
  postingAttempts: number
}

/** Just the Prisma calls the own-catalog check makes. */
function fakePrisma(listing: FakeListing, wallapopUserId: string | null) {
  const updates: unknown[] = []
  const full = () => ({
    ...listing,
    externalItemId: null,
    shippingEnabled: true,
    shippingUpToKg: null,
    lastPostedAt: null,
    updatedAt: null,
  })
  const prisma = {
    account: { findUnique: async () => ({ wallapopUserId }) },
    productListing: {
      findUnique: async () => full(),
      findFirst: async () => null,
      findMany: async () => [
        {
          id: listing.id,
          status: listing.status,
          externalUrl: listing.externalUrl,
          variantTitle: listing.variantTitle,
          variantPrice: listing.variantPrice,
          product: {
            sku: "WP-LUK",
            title: "LuK 600001700 Repset Dmf Kit de Embrague",
            price: 149.99,
            status: "ACTIVE",
          },
        },
      ],
      updateMany: async (args: { data: Partial<FakeListing> }) => {
        updates.push(args)
        Object.assign(listing, args.data)
        return { count: 1 }
      },
    },
  }
  return { prisma, updates }
}

function lukListing(): FakeListing {
  return {
    id: "listing-luk-w2",
    accountId: W2,
    status: "READY_TO_POST",
    externalUrl: null,
    variantTitle: "Juego embrague LuK 600001700 (DMF)",
    variantPrice: 149.98,
    postingAttempts: 1,
  }
}

function prepare(accountId: string, prisma: unknown, listingId: string) {
  prepared.value = {
    ok: true,
    prisma,
    accountId,
    dryRun: false,
    product: { id: "product-luk", listings: [{ id: listingId, accountId }] },
  }
}

function sellerApi(items: Array<{ title: string; slug: string; amount: number }>) {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({
        data: items.map((item, index) => ({
          id: `id-${index}`,
          title: item.title,
          slug: item.slug,
          price: { amount: item.amount },
        })),
        meta: {},
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  )
}

let offline: string | undefined

beforeEach(() => {
  offline = process.env.WALLAPOP_OFFLINE
  delete process.env.WALLAPOP_OFFLINE
  resetSellerUserIdCacheForTests()
  spies.logs.length = 0
  spies.claim.mockReset().mockResolvedValue({ ok: true, claimed: true })
  spies.execute.mockReset().mockResolvedValue({
    ok: true,
    dryRun: false,
    listing: null,
    step: "published",
  })
  spies.adoptDefault.mockReset().mockResolvedValue(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
  if (offline === undefined) delete process.env.WALLAPOP_OFFLINE
  else process.env.WALLAPOP_OFFLINE = offline
})

describe("non-default account: own public catalog before publish", () => {
  it("W2: listing already in its own account's API -> no repeat publish", async () => {
    const listing = lukListing()
    const { prisma, updates } = fakePrisma(listing, "w2-seller")
    const fetchSpy = sellerApi([
      {
        title: "Juego embrague LuK 600001700 (DMF)",
        slug: "juego-embrague-luk-600001700-dmf-1318912350",
        amount: 149.98,
      },
    ])
    vi.stubGlobal("fetch", fetchSpy)
    prepare(W2, prisma, listing.id)

    const result = await runProductPublish("product-luk", { accountId: W2 })

    expect(result).toMatchObject({ ok: true, step: "already_live" })
    expect(result.ok && result.listing?.externalUrl).toBe(LUK_URL)
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("/api/v3/users/w2-seller/items")
    expect(spies.claim).not.toHaveBeenCalled()
    expect(spies.execute).not.toHaveBeenCalled()
    expect(updates).toHaveLength(1)
    expect(listing).toMatchObject({ status: "ACTIVE", externalUrl: LUK_URL, postingAttempts: 0 })
  })

  it("API down: skips without claim or FAILED, warns with accountId", async () => {
    const listing = lukListing()
    const { prisma, updates } = fakePrisma(listing, "w2-seller")
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })))
    prepare(W2, prisma, listing.id)

    const result = await runProductPublish("product-luk", { accountId: W2 })

    expect(result).toMatchObject({ ok: false, httpStatus: 409, code: "LIVE_CHECK_UNAVAILABLE" })
    expect(spies.claim).not.toHaveBeenCalled()
    expect(spies.execute).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
    expect(listing).toMatchObject({ status: "READY_TO_POST", postingAttempts: 1 })
    expect(spies.logs).toContainEqual({
      level: "warn",
      msg: "wallapop_publish_live_check_unavailable",
      data: expect.objectContaining({ accountId: W2, reason: "catalog_unreadable" }),
    })
  })

  it("no seller id for the account: same skip, never publishes blind", async () => {
    const listing = lukListing()
    const { prisma } = fakePrisma(listing, null)
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    prepare(W2, prisma, listing.id)

    const result = await runProductPublish("product-luk", { accountId: W2 })

    expect(result).toMatchObject({ ok: false, code: "LIVE_CHECK_UNAVAILABLE" })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(spies.claim).not.toHaveBeenCalled()
  })

  it("two matching items on the profile: skip instead of guessing", async () => {
    const listing = lukListing()
    const { prisma, updates } = fakePrisma(listing, "w2-seller")
    vi.stubGlobal(
      "fetch",
      sellerApi([
        { title: "Juego embrague LuK 600001700 (DMF)", slug: "juego-embrague-luk-600001700-dmf-1", amount: 149.98 },
        { title: "Juego embrague LuK 600001700 (DMF)", slug: "juego-embrague-luk-600001700-dmf-2", amount: 149.98 },
      ]),
    )
    prepare(W2, prisma, listing.id)

    const result = await runProductPublish("product-luk", { accountId: W2 })

    expect(result).toMatchObject({ ok: false, code: "LIVE_CHECK_UNAVAILABLE" })
    expect(updates).toHaveLength(0)
    expect(spies.claim).not.toHaveBeenCalled()
  })

  it("not on the profile yet: publishes as before", async () => {
    const listing = lukListing()
    const { prisma } = fakePrisma(listing, "w2-seller")
    vi.stubGlobal(
      "fetch",
      sellerApi([{ title: "Bomba de calor Gre Pools para piscina", slug: "bomba-de-calor-gre-1318911989", amount: 899.98 }]),
    )
    prepare(W2, prisma, listing.id)

    const result = await runProductPublish("product-luk", { accountId: W2 })

    expect(result).toMatchObject({ ok: true, step: "published" })
    expect(spies.claim).toHaveBeenCalledTimes(1)
    expect(spies.execute).toHaveBeenCalledTimes(1)
  })

  it("default account keeps its old check and never reads the own-catalog API here", async () => {
    const listing = { ...lukListing(), accountId: "acc-pro" }
    const { prisma } = fakePrisma(listing, "pro-seller")
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    prepare("acc-pro", prisma, listing.id)

    const result = await runProductPublish("product-luk")

    expect(result).toMatchObject({ ok: true, step: "published" })
    expect(spies.adoptDefault).toHaveBeenCalledTimes(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
