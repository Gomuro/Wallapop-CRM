import fs from "node:fs"
import path from "node:path"

import { chromium, type Browser, type Page } from "playwright"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"

import { scrapeProActivos, setProPageWaitsForTests } from "../src/lib/wallapop-monitor/pro-catalog-pages"

const FIXTURE = fs.readFileSync(path.join(__dirname, "fixtures", "wallapop-pro-catalog-pager.html"), "utf8")

/** Short waits so the slow page outlasts the first wait but not the retry. */
const WAITS = { page: 300, staleRetry: 2_000 }

describe("scrapeProActivos with pages that load late", () => {
  let browser: Browser
  let page: Page

  async function catalog(options: Record<string, unknown>) {
    await page.setContent(FIXTURE)
    await page.evaluate(`window.__catalog.configure(${JSON.stringify(options)})`)
  }

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true })
    page = await browser.newPage()
    setProPageWaitsForTests(WAITS)
  })

  afterEach(() => setProPageWaitsForTests(WAITS))

  afterAll(async () => {
    setProPageWaitsForTests(null)
    await browser.close()
  })

  it("reads every page when the rows arrive after the pager", async () => {
    await catalog({ total: 100, rowDelays: { 1: 900, 2: 900 } })
    const snapshot = await scrapeProActivos(page)
    expect(snapshot.complete).toBe(true)
    expect(snapshot.rows).toHaveLength(100)
    expect(new Set(snapshot.rows.map((row) => row.href)).size).toBe(100)
  }, 20_000)

  it("stops, without skipping ahead, when a page never loads", async () => {
    await catalog({ total: 100, rowDelays: { 1: -1 } })
    const snapshot = await scrapeProActivos(page)
    expect(snapshot.complete).toBe(false)
    expect(snapshot.rows).toHaveLength(40)
    const clicked = await page.evaluate("window.__catalog.page")
    expect(clicked).toBe(1)
  }, 20_000)

  it("needs the largest total the pager showed, not the last one", async () => {
    await catalog({ total: 100, pagerTotals: { 0: 100, 1: 90, 2: 90 } })
    const snapshot = await scrapeProActivos(page)
    expect(snapshot.total).toBe(100)
    expect(snapshot.rows).toHaveLength(100)
    expect(snapshot.complete).toBe(true)
  }, 20_000)

  it("counts a pass as complete when all rows are there and the pager shows fewer", async () => {
    await catalog({ total: 100, pagerTotals: { 0: 90, 1: 90, 2: 90 } })
    const snapshot = await scrapeProActivos(page)
    expect(snapshot.rows).toHaveLength(100)
    expect(snapshot.complete).toBe(true)
  }, 20_000)
})
