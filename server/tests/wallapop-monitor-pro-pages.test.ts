import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { chromium, type Browser, type Page } from "playwright"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

const logged = vi.hoisted(() => [] as Array<{ msg: string; extra?: Record<string, unknown> }>)

vi.mock("../src/lib/log", async (original) => ({
  ...(await original<typeof import("../src/lib/log")>()),
  log: (_level: string, msg: string, extra?: Record<string, unknown>) => {
    logged.push({ msg, extra })
  },
}))

import { setProSnapshotDirForTests } from "../src/lib/wallapop-monitor/pro-catalog-diag"
import {
  scrapeProActivos,
  scrapeProCatalogs,
  setProPageWaitsForTests,
} from "../src/lib/wallapop-monitor/pro-catalog-pages"

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

  it("logs every Activos page: pager, rows, new rows, first and last link", async () => {
    logged.length = 0
    await catalog({ total: 100, pagerTotals: { 1: 90 } })
    await scrapeProActivos(page)
    const pages = logged.filter((entry) => entry.msg === "wallapop_monitor_pro_page").map((entry) => entry.extra)
    expect(pages).toHaveLength(3)
    expect(pages[1]).toMatchObject({ tab: "Activos", page: 2, pager: "41-80 de 90", rows: 40, newRows: 40 })
    expect(String(pages[2]?.firstHref)).toContain("/item/producto-80-")
    expect(String(pages[2]?.lastHref)).toContain("/item/producto-99-")
  }, 20_000)

  it("saves the table of the page an incomplete pass ended on, and says where", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pro-catalog-"))
    setProSnapshotDirForTests(dir)
    logged.length = 0
    try {
      await catalog({ total: 100, rowDelays: { 1: -1 } })
      expect(await scrapeProCatalogs(page)).toBeNull()
      const incomplete = logged.find((entry) => entry.msg === "wallapop_monitor_pro_incomplete")
      const file = String(incomplete?.extra?.snapshot)
      expect(file).toBe(path.join(dir, "activos-incomplete-0.html"))
      const html = fs.readFileSync(file, "utf8")
      expect(html).toContain('collected 40 of 100; pager "41-80 de 100"; rows on page 40')
      expect(html).toContain("CatalogItem_0")
      expect(html).not.toContain("<script")
    } finally {
      setProSnapshotDirForTests(null)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)

  it("counts a pass as complete when all rows are there and the pager shows fewer", async () => {
    await catalog({ total: 100, pagerTotals: { 0: 90, 1: 90, 2: 90 } })
    const snapshot = await scrapeProActivos(page)
    expect(snapshot.rows).toHaveLength(100)
    expect(snapshot.complete).toBe(true)
  }, 20_000)
})
