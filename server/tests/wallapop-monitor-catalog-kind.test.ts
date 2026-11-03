import { chromium, type Page } from "playwright"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { wallapopCatalogKind } from "../src/lib/wallapop-monitor/pro-catalog"

const BASE = "https://catalog.test/app/catalog/management"
const FAST = { budgetMs: 3_000, pollMs: 100 }

let browser: Awaited<ReturnType<typeof chromium.launch>>

beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
})

afterAll(async () => {
  await browser.close()
})

const later = (ms: number, html: string) =>
  `<body><script>setTimeout(() => { document.body.insertAdjacentHTML("beforeend", ${JSON.stringify(html)}) }, ${ms})</script></body>`

const ACTIVOS = `<wallapop-tab aria-label="Activos (540)"></wallapop-tab>`

async function servedPage(pages: Record<string, () => string>): Promise<{ page: Page; hits: Record<string, number> }> {
  const page = await browser.newPage()
  const hits: Record<string, number> = {}
  await page.route("https://catalog.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    hits[path] = (hits[path] ?? 0) + 1
    const body = pages[path]?.() ?? "<body></body>"
    await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body })
  })
  return { page, hits }
}

describe("wallapopCatalogKind", () => {
  it("waits for a slow Pro page", async () => {
    const { page } = await servedPage({ "/app/catalog/management": () => later(800, ACTIVOS) })
    await page.goto(BASE)
    expect(await wallapopCatalogKind(page, FAST)).toBe("pro")
    await page.close()
  })

  it("survives the redirect to /consumergoods while it loads", async () => {
    const { page } = await servedPage({
      "/app/catalog/management": () =>
        `<body><script>setTimeout(() => location.replace("/app/catalog/management/consumergoods"), 300)</script></body>`,
      "/app/catalog/management/consumergoods": () => later(700, ACTIVOS),
    })
    await page.goto(BASE)
    expect(await wallapopCatalogKind(page, FAST)).toBe("pro")
    expect(page.url()).toContain("/consumergoods")
    await page.close()
  })

  it("reloads once when the page stays empty, then reads it", async () => {
    let served = 0
    const { page, hits } = await servedPage({
      "/app/catalog/management": () => {
        served += 1
        return served === 1 ? "<body>cargando</body>" : later(200, `<tsl-catalog-item></tsl-catalog-item>`)
      },
    })
    await page.goto(BASE)
    expect(await wallapopCatalogKind(page, { budgetMs: 600, pollMs: 100 })).toBe("classic")
    expect(hits["/app/catalog/management"]).toBe(2)
    await page.close()
  })

  it("gives up as unknown after the reload", async () => {
    const { page, hits } = await servedPage({ "/app/catalog/management": () => "<body>nada</body>" })
    await page.goto(BASE)
    expect(await wallapopCatalogKind(page, { budgetMs: 400, pollMs: 100 })).toBe("unknown")
    expect(hits["/app/catalog/management"]).toBe(2)
    await page.close()
  })
})
