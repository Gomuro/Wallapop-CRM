import { describe, expect, it } from "vitest"

import { productListingApiPutBodySchema } from "../../lib/validations/listing"
import {
  classifyPublishLanding,
  isPublicarContextDestroyedError,
  isWallapopPublishedCatalogUrl,
  listingUrlFromPageUrl,
  readLandingAfterPublicarClick,
  readUrlAfterPublicarClick,
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
