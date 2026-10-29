import type { Page } from "playwright"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { LiveCatalogItem } from "../src/lib/wallapop-live-catalog"

const profile = vi.hoisted(() => ({ items: null as LiveCatalogItem[] | null, accounts: [] as string[] }))

vi.mock("../src/lib/db", () => ({ getPrisma: () => ({}) }))
vi.mock("../src/lib/wallapop-already-live", () => ({
  loadSellerCatalog: async (_prisma: unknown, accountId: string) => {
    profile.accounts.push(accountId)
    return profile.items
  },
}))

import { readPublishedFromProfile } from "../src/lib/wallapop-monitor/published-from-profile"
import { scrapeCatalogs } from "../src/lib/wallapop-monitor/tick-scrape"

function item(slug: string, reserved = false): LiveCatalogItem {
  return { id: slug, href: `https://es.wallapop.com/item/${slug}`, title: slug, price: 9.95, priceText: "9,95", reserved }
}

afterEach(() => {
  profile.items = null
  profile.accounts = []
})

describe("readPublishedFromProfile", () => {
  it("gives the monitor every ad for sale on the profile, with its reserved flag", async () => {
    profile.items = [item("sarten-1312831557"), item("lampara-1307308862", true)]
    expect(await readPublishedFromProfile("acc-1", 2)).toEqual([
      { href: "https://es.wallapop.com/item/sarten-1312831557", reserved: false },
      { href: "https://es.wallapop.com/item/lampara-1307308862", reserved: true },
    ])
    expect(profile.accounts).toEqual(["acc-1"])
  })

  it("is null when the profile could not be read", async () => {
    profile.items = null
    expect(await readPublishedFromProfile("acc-1", 5)).toBeNull()
  })

  it("does not trust an empty profile while the CRM has ads on Wallapop", async () => {
    profile.items = []
    expect(await readPublishedFromProfile("acc-1", 5)).toBeNull()
    expect(await readPublishedFromProfile("acc-1", 0)).toEqual([])
  })
})

describe("scrapeCatalogs", () => {
  it("stops before Chrome when the profile did not answer: the pass is incomplete", async () => {
    profile.items = null
    const page = new Proxy({}, {
      get() {
        throw new Error("Chrome must not be touched without the profile")
      },
    }) as unknown as Page
    expect(await scrapeCatalogs(page, "acc-1", 3)).toBeNull()
  })
})
