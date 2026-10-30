import { chromium, type Browser, type Page } from "playwright"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"

import { waitForLoginOutcome } from "../src/lib/wallapop-browser/login"
import { setWallapopHandle } from "../src/lib/wallapop-cdp"

const MAIN_PORT = 9222
const SECOND_PORT = 9232
const CATALOG = "https://es.wallapop.com/app/catalog/management"
const KEYCLOAK = "https://accounts.wallapop.com/realms/wallapop-internal/protocol/openid-connect/auth"

let browser: Browser

beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
})

afterAll(async () => {
  await browser.close()
})

afterEach(() => {
  setWallapopHandle(null, MAIN_PORT)
  setWallapopHandle(null, SECOND_PORT)
})

/** One Chrome per account: a context with a single page on a stubbed Wallapop URL. */
async function chromeAt(port: number, url: string): Promise<Page> {
  const context = await browser.newContext()
  await context.route("**/*", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<body></body>" }),
  )
  const page = await context.newPage()
  await page.goto(url)
  setWallapopHandle({ browser, context, page, ownedPage: true }, port)
  return page
}

describe("waitForLoginOutcome checks only the account's own Chrome", () => {
  it("does not take the main account's logged-in catalog as Wallapop 2's login", async () => {
    await chromeAt(MAIN_PORT, CATALOG)
    const second = await chromeAt(SECOND_PORT, KEYCLOAK)
    expect(await waitForLoginOutcome(second, SECOND_PORT, 1_000)).toBe("FAILED")
  })

  it("reports ACTIVE when Wallapop 2's own Chrome is on the catalog", async () => {
    await chromeAt(MAIN_PORT, KEYCLOAK)
    const second = await chromeAt(SECOND_PORT, CATALOG)
    expect(await waitForLoginOutcome(second, SECOND_PORT, 1_000)).toBe("ACTIVE")
  })

  it("still checks the main account on its own port", async () => {
    const main = await chromeAt(MAIN_PORT, CATALOG)
    await chromeAt(SECOND_PORT, KEYCLOAK)
    expect(await waitForLoginOutcome(main, MAIN_PORT, 1_000)).toBe("ACTIVE")
  })
})
