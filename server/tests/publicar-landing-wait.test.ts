import { describe, expect, it } from "vitest"

import {
  classifyPublishLanding,
  readLandingAfterPublicarClick,
} from "../src/lib/wallapop-publish/verify"

/** Virtual clock: the page only sees the time its own waits add up to. */
function slowLanding(leavesFormAtMs: number | null) {
  let clock = 0
  return {
    waitForTimeout: async (ms: number) => {
      clock += ms
    },
    url: () =>
      leavesFormAtMs != null && clock >= leavesFormAtMs
        ? "https://es.wallapop.com/app/catalog/published"
        : "https://es.wallapop.com/app/catalog/upload/consumer-goods",
    elapsed: () => clock,
  }
}

describe("landing wait after Publicar", () => {
  it("W2 Somier 30.10: the form closes at ~6 s, not a failed publish", async () => {
    const page = slowLanding(6_000)
    const landing = await readLandingAfterPublicarClick(page)
    expect(landing).toEqual({
      url: "https://es.wallapop.com/app/catalog/published",
      urlReadFailed: false,
    })
    expect(classifyPublishLanding({ ...landing, reviewMessage: null })).toEqual({
      ok: true,
      reason: "published_catalog",
    })
    expect(page.elapsed()).toBe(6_000)
  })

  it("gives up on the upload form at 20 s", async () => {
    const page = slowLanding(null)
    const landing = await readLandingAfterPublicarClick(page)
    expect(classifyPublishLanding({ ...landing, reviewMessage: null })).toMatchObject({
      ok: false,
      reason: "still_on_upload",
    })
    expect(page.elapsed()).toBe(20_000)
  })

  it("a fast landing still costs only the 5 s settle", async () => {
    const page = slowLanding(0)
    await readLandingAfterPublicarClick(page)
    expect(page.elapsed()).toBe(5_000)
  })
})
