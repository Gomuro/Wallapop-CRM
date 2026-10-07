import fs from "node:fs"
import path from "node:path"

import { chromium } from "playwright"
import { describe, expect, it } from "vitest"

import { productListingApiPutBodySchema } from "../../lib/validations/listing"
import {
  classifyPublishLanding,
  isPublicarContextDestroyedError,
  isWallapopPublishedCatalogUrl,
  listingUrlFromPageUrl,
  normalizePublishTitle,
  parseCatalogPriceEur,
  pickUniqueCatalogItemUrl,
  PUBLISHED_CATALOG_ITEMS_EVAL,
  readLandingAfterPublicarClick,
  readUrlAfterPublicarClick,
  type PublishedCatalogItem,
} from "../src/lib/wallapop-publish"
import { shouldRevertPublishClaim } from "../src/routes/product-publish"

describe("readUrlAfterPublicarClick", () => {
  it("returns the listing URL when the page stays open", async () => {
    const url = await readUrlAfterPublicarClick(
      {
        waitForTimeout: async () => undefined,
        url: () => "https://es.wallapop.com/item/abc",
      },
      0,
    )
    expect(url).toBe("https://es.wallapop.com/item/abc")
  })

  it("marks Target closed as urlReadFailed, not as /item/", async () => {
    const landing = await readLandingAfterPublicarClick(
      {
        waitForTimeout: async () => {
          throw new Error("Target closed")
        },
        url: () => "https://es.wallapop.com/app/catalog/published",
      },
      0,
    )
    expect(landing).toEqual({ url: null, urlReadFailed: true })
  })

  it("returns null if wait or url throws after Publicar (Target closed)", async () => {
    const fromWait = await readUrlAfterPublicarClick(
      {
        waitForTimeout: async () => {
          throw new Error("Target closed")
        },
        url: () => "https://es.wallapop.com/item/abc",
      },
      0,
    )
    expect(fromWait).toBeNull()

    const fromUrl = await readUrlAfterPublicarClick(
      {
        waitForTimeout: async () => undefined,
        url: () => {
          throw new Error("Target closed")
        },
      },
      0,
    )
    expect(fromUrl).toBeNull()
  })
})

describe("listingUrlFromPageUrl", () => {
  it("keeps Wallapop item URLs", () => {
    expect(listingUrlFromPageUrl("https://es.wallapop.com/item/1")).toBe(
      "https://es.wallapop.com/item/1",
    )
  })

  it("rejects the upload form URL (Publicar bounced, not posted)", () => {
    expect(
      listingUrlFromPageUrl(
        "https://es.wallapop.com/app/catalog/upload/consumer-goods",
      ),
    ).toBeNull()
  })

  it("rejects the Wallapop homepage (not a listing)", () => {
    expect(listingUrlFromPageUrl("https://es.wallapop.com")).toBeNull()
    expect(listingUrlFromPageUrl("https://es.wallapop.com/")).toBeNull()
  })

  it("drops other hosts", () => {
    expect(listingUrlFromPageUrl("https://example.com/x")).toBeNull()
  })
})

describe("classifyPublishLanding", () => {
  const published = "https://es.wallapop.com/app/catalog/published"

  it("accepts Tu Catálogo published as hung", () => {
    expect(
      classifyPublishLanding({
        url: published,
        urlReadFailed: false,
        reviewMessage: null,
      }),
    ).toEqual({ ok: true, reason: "published_catalog" })
    expect(isWallapopPublishedCatalogUrl(published)).toBe(true)
  })

  it("rejects upload form and Revisa banner", () => {
    expect(
      classifyPublishLanding({
        url: "https://es.wallapop.com/app/catalog/upload/consumer-goods",
        urlReadFailed: false,
        reviewMessage: null,
      }).reason,
    ).toBe("still_on_upload")
    expect(
      classifyPublishLanding({
        url: "https://es.wallapop.com/app/catalog/upload/consumer-goods",
        urlReadFailed: false,
        reviewMessage: "Wallapop pidió revisar campos en rojo.",
      }).reason,
    ).toBe("review_banner")
  })

  it("does not mark ACTIVE when the tab is gone or URL is not the catalog", () => {
    expect(
      classifyPublishLanding({
        url: null,
        urlReadFailed: true,
        reviewMessage: null,
      }).reason,
    ).toBe("target_closed")
    expect(
      classifyPublishLanding({
        url: "https://es.wallapop.com/wall",
        urlReadFailed: false,
        reviewMessage: null,
      }).reason,
    ).toBe("unexpected_url")
  })
})

describe("pickUniqueCatalogItemUrl", () => {
  const helmet = {
    title: "Casco Moto LS2 Advant Carbono XL",
    href: "https://es.wallapop.com/item/casco-moto-ls2-advant-carbono-xl-1309517660",
    priceText: "209,95 €",
  }
  const other = {
    title: "Barrera Seguridad Infantil 73–80 cm",
    href: "https://es.wallapop.com/item/barrera-seguridad-1300000001",
    priceText: "29,99 €",
  }

  it("picks the catalog row by title, not the first item", () => {
    const picked = pickUniqueCatalogItemUrl([other, helmet], {
      title: "Casco Moto LS2 Advant Carbono XL",
      price: 209.95,
    })
    expect(picked).toEqual({ href: helmet.href, reason: "matched" })
    expect(parseCatalogPriceEur(helmet.priceText)).toBe(209.95)
  })

  it("uses price when two rows share the title", () => {
    const cheap = {
      ...helmet,
      href: "https://es.wallapop.com/item/casco-barato-111",
      priceText: "50 €",
    }
    const picked = pickUniqueCatalogItemUrl([cheap, helmet], {
      title: helmet.title,
      price: 209.95,
    })
    expect(picked).toEqual({ href: helmet.href, reason: "matched_price" })
  })

  it("does not write upload/published URLs and does not guess", () => {
    expect(
      pickUniqueCatalogItemUrl(
        [
          {
            title: helmet.title,
            href: "https://es.wallapop.com/app/catalog/published",
            priceText: helmet.priceText,
          },
        ],
        { title: helmet.title, price: 209.95 },
      ).reason,
    ).toBe("none")
    expect(
      pickUniqueCatalogItemUrl(
        [
          { ...helmet, href: "https://es.wallapop.com/item/a-1" },
          { ...helmet, href: "https://es.wallapop.com/item/a-2" },
        ],
        { title: helmet.title, price: 209.95 },
      ).reason,
    ).toBe("ambiguous")
  })

  it("scrapes the captured tsl-catalog-item HTML like live publish", async () => {
    const html = fs.readFileSync(
      path.join(__dirname, "fixtures/wallapop-tsl-catalog-item.html"),
      "utf8",
    )
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setContent(
        `<!DOCTYPE html><html><body>${html}</body></html>`,
      )
      const rows = (await page.evaluate(
        PUBLISHED_CATALOG_ITEMS_EVAL,
      )) as PublishedCatalogItem[]
      expect(rows).toHaveLength(1)
      expect(normalizePublishTitle(rows[0]?.title ?? "")).toBe(
        "Casco Moto LS2 Advant Carbono XL",
      )
      const picked = pickUniqueCatalogItemUrl(rows, {
        title: "Casco Moto LS2 Advant Carbono XL",
        price: 209.95,
      })
      expect(picked.href).toBe(
        "https://es.wallapop.com/item/casco-moto-ls2-advant-carbono-xl-1309517660",
      )
      expect(picked.reason).toBe("matched")
    } finally {
      await browser.close()
    }
  })
})

describe("isPublicarContextDestroyedError", () => {
  it("detects Target closed / destroyed context", () => {
    expect(
      isPublicarContextDestroyedError(new Error("Target closed")),
    ).toBe(true)
    expect(
      isPublicarContextDestroyedError(
        new Error("Execution context was destroyed"),
      ),
    ).toBe(true)
    expect(isPublicarContextDestroyedError(new Error("timeout"))).toBe(false)
  })
})

describe("clicked Publicar revert policy", () => {
  it("never reverts after Publicar click even if URL read failed", () => {
    const claimed = true
    const postedOnWallapop = false
    const clickedPublicar = true
    expect(
      shouldRevertPublishClaim(claimed, postedOnWallapop, clickedPublicar),
    ).toBe(false)
  })

  it("reverts only when claimed and Publicar was never clicked", () => {
    expect(shouldRevertPublishClaim(true, false, false)).toBe(true)
  })
})

describe("productListingApiPutBodySchema", () => {
  it("keeps public /item/ URLs and coerces junk to null", () => {
    expect(
      productListingApiPutBodySchema.parse({
        externalUrl: "https://es.wallapop.com/item/andador",
      }).externalUrl,
    ).toBe("https://es.wallapop.com/item/andador")
    expect(
      productListingApiPutBodySchema.parse({
        externalUrl: "https://es.wallapop.com",
      }).externalUrl,
    ).toBeNull()
    expect(
      productListingApiPutBodySchema.parse({
        externalUrl:
          "https://es.wallapop.com/app/catalog/upload/consumer-goods",
      }).externalUrl,
    ).toBeNull()
    expect(
      productListingApiPutBodySchema.parse({ externalUrl: "" }).externalUrl,
    ).toBeNull()
  })
})
