import { describe, expect, it } from "vitest"

import {
  isPublicarContextDestroyedError,
  listingUrlFromPageUrl,
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

  it("drops other hosts", () => {
    expect(listingUrlFromPageUrl("https://example.com/x")).toBeNull()
  })
})

describe("isPublicarContextDestroyedError", () => {
  it("treats Target closed / destroyed context as posted-safe", () => {
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
