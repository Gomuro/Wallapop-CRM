import fs from "node:fs"
import path from "node:path"

import { chromium } from "playwright"
import { afterEach, describe, expect, it } from "vitest"

import {
  wallapopEsItemUrlOrNull,
  wallapopItemPathKey,
} from "../../lib/inventory/wallapop-item-url"
import {
  CLICK_MARK_AS_SOLD_EVAL,
  FIND_SELLER_SOLD_EVAL,
  firstSoldCatalogHrefMatches,
  SOLD_CATALOG_ROWS_EVAL,
} from "../src/lib/wallapop-sold"
import {
  isSoldDryRun,
  listingForSold,
} from "../src/routes/product-wallapop-sold-prepare"

const MESA =
  "https://es.wallapop.com/item/mesa-auxiliar-cama-teqler-regulable-1310760208"

describe("wallapopEsItemUrlOrNull", () => {
  it("keeps es.wallapop.com /item/ and rejects junk", () => {
    expect(wallapopEsItemUrlOrNull(MESA)).toBe(MESA)
    expect(
      wallapopEsItemUrlOrNull("https://fr.wallapop.com/item/foo-1"),
    ).toBeNull()
    expect(
      wallapopEsItemUrlOrNull("https://es.wallapop.com/app/catalog/published"),
    ).toBeNull()
    expect(
      wallapopEsItemUrlOrNull("https://es.wallapop.com/app/catalog/upload"),
    ).toBeNull()
  })
})

describe("listingForSold", () => {
  it("requires ACTIVE listing with es /item/ URL", () => {
    expect(
      listingForSold({
        status: "SOLD",
        listings: [{ status: "ACTIVE", externalUrl: MESA }],
      }),
    ).toMatchObject({ ok: false, code: "ALREADY_SOLD" })
    expect(
      listingForSold({
        status: "ACTIVE",
        listings: [{ status: "READY_TO_POST", externalUrl: MESA }],
      }),
    ).toMatchObject({ code: "LISTING_NOT_ACTIVE" })
    expect(
      listingForSold({
        status: "ACTIVE",
        listings: [
          { status: "ACTIVE", externalUrl: "https://es.wallapop.com/upload/x" },
        ],
      }),
    ).toMatchObject({ code: "NO_ITEM_URL" })
    expect(
      listingForSold({
        status: "ACTIVE",
        listings: [{ status: "ACTIVE", externalUrl: MESA }],
      }),
    ).toEqual({ itemUrl: MESA })
  })
})

describe("isSoldDryRun", () => {
  const prev = process.env.WALLAPOP_SOLD_DRY_RUN
  afterEach(() => {
    if (prev === undefined) delete process.env.WALLAPOP_SOLD_DRY_RUN
    else process.env.WALLAPOP_SOLD_DRY_RUN = prev
  })

  it("is on unless WALLAPOP_SOLD_DRY_RUN is exactly false", () => {
    delete process.env.WALLAPOP_SOLD_DRY_RUN
    expect(isSoldDryRun()).toBe(true)
    process.env.WALLAPOP_SOLD_DRY_RUN = "true"
    expect(isSoldDryRun()).toBe(true)
    process.env.WALLAPOP_SOLD_DRY_RUN = "FALSE"
    expect(isSoldDryRun()).toBe(true)
    process.env.WALLAPOP_SOLD_DRY_RUN = "false"
    expect(isSoldDryRun()).toBe(false)
  })
})

describe("sold DOM fixtures", () => {
  it("finds Marcar como vendido in the seller block, not Destacar", async () => {
    const html = fs.readFileSync(
      path.join(__dirname, "fixtures/wallapop-item-seller-sold.html"),
      "utf8",
    )
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setContent(html)
      expect(await page.evaluate(FIND_SELLER_SOLD_EVAL)).toBe("found")
    } finally {
      await browser.close()
    }
  })

  it("finds #markAsSoldButton on the sold modal fixture", async () => {
    const html = fs.readFileSync(
      path.join(__dirname, "fixtures/wallapop-sold-modal.html"),
      "utf8",
    )
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setContent(html)
      expect(await page.evaluate(CLICK_MARK_AS_SOLD_EVAL)).toBe("clicked")
    } finally {
      await browser.close()
    }
  })

  it("matches the first Vendidos row by href, not title", async () => {
    const html = fs.readFileSync(
      path.join(__dirname, "fixtures/wallapop-catalog-sold.html"),
      "utf8",
    )
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setContent(html)
      const rows = (await page.evaluate(SOLD_CATALOG_ROWS_EVAL)) as {
        href: string
        sold: boolean
      }[]
      expect(rows[0]?.sold).toBe(true)
      expect(firstSoldCatalogHrefMatches(rows, MESA)).toBe(true)
      expect(
        firstSoldCatalogHrefMatches(rows, "https://es.wallapop.com/item/other-1"),
      ).toBe(false)
      expect(wallapopItemPathKey(rows[0]?.href)).toBe(wallapopItemPathKey(MESA))
    } finally {
      await browser.close()
    }
  })
})
