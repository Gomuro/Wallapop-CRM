import type { Page } from "playwright"

import { log } from "../log"
import type { PublishedCatalogRow } from "./catalog"
import type { SoldCatalogRow } from "./diff"

const MAX_PAGES = 20
const PAGE_WAIT_MS = 8_000

export function parseProPager(
  text: string,
): { from: number; to: number; total: number } | null {
  const match = text
    .replace(/\s+/g, " ")
    .trim()
    .match(/(\d+)\s*-\s*(\d+)\s*de\s*(\d+)/i)
  if (!match) return null
  return {
    from: Number(match[1]),
    to: Number(match[2]),
    total: Number(match[3]),
  }
}

const PAGE_KIND_EVAL = `(() => {
  const activo = [...document.querySelectorAll("wallapop-tab")].find((el) =>
    (el.getAttribute("aria-label") || "").startsWith("Activos"),
  )
  if (activo) return "pro"
  if (document.querySelector("tsl-catalog-item")) return "classic"
  return "unknown"
})()`

const ROWS_EVAL = `(() => {
  function walk(root, visit) {
    if (!root || !root.querySelectorAll) return
    root.querySelectorAll("*").forEach((el) => {
      visit(el)
      if (el.shadowRoot) walk(el.shadowRoot, visit)
    })
  }
  const rows = []
  document.querySelectorAll('tr[id^="CatalogItem_"]').forEach((row) => {
    let href = ""
    let reserved = false
    walk(row, (node) => {
      if (
        !href &&
        node.tagName === "A" &&
        String(node.href || "").includes("/item/")
      ) {
        href = String(node.href)
      }
      if (
        node.tagName === "WALLAPOP-BADGE" &&
        node.getAttribute("badgetype") === "reserved"
      ) {
        reserved = true
      }
    })
    if (href) rows.push({ href, reserved })
  })
  const info = document.querySelector(
    "tsl-pagination-actions .PaginationActions__info",
  )
  return {
    rows,
    pager: info ? String(info.textContent || "").replace(/\\s+/g, " ").trim() : "",
  }
})()`

function clickTabEval(prefix: string): string {
  return `(() => {
    const prefix = ${JSON.stringify(prefix.toLowerCase())}
    const tab = [...document.querySelectorAll("wallapop-tab")].find((el) =>
      (el.getAttribute("aria-label") || "").toLowerCase().startsWith(prefix),
    )
    if (!tab) return false
    tab.click()
    return true
  })()`
}

const CLICK_NEXT_EVAL = `(() => {
  const host = document.querySelector("tsl-pagination-actions")
  if (!host) return false
  const icons = [...host.querySelectorAll("walla-icon.PaginationActions__action")]
  const next = icons[icons.length - 1]
  if (!next || next.classList.contains("PaginationActions__action--disabled")) {
    return false
  }
  next.click()
  return true
})()`

type PageShot = {
  rows: PublishedCatalogRow[]
  pager: string
}

export async function wallapopCatalogKind(
  page: Page,
): Promise<"pro" | "classic" | "unknown"> {
  await page
    .waitForFunction(
      `Boolean(
        document.querySelector("wallapop-tab[aria-label^='Activos']") ||
        document.querySelector("tsl-catalog-item")
      )`,
      { timeout: 20_000 },
    )
    .catch(() => {})
  const kind = (await page.evaluate(PAGE_KIND_EVAL)) as string
  if (kind === "pro" || kind === "classic") return kind
  return "unknown"
}

async function readShot(page: Page): Promise<PageShot> {
  const shot = (await page.evaluate(ROWS_EVAL)) as PageShot | null
  return { rows: shot?.rows ?? [], pager: shot?.pager ?? "" }
}

type CatalogPageExpect = {
  tab?: string
  previousPager?: string
  previousHref?: string
}

type CatalogEl = {
  getAttribute(name: string): string | null
  textContent: string | null
  href: string
}

type CatalogDocument = {
  querySelector(selector: string): CatalogEl | null
  querySelectorAll(selector: string): CatalogEl[]
}

const catalogPageSettled = (input: CatalogPageExpect): boolean => {
  const document = (globalThis as unknown as { document: CatalogDocument })
    .document
  const Anchor = (
    globalThis as unknown as { HTMLAnchorElement: new () => { href: string } }
  ).HTMLAnchorElement
  if (input.tab) {
    const tab = [...document.querySelectorAll("wallapop-tab")].find((el) =>
      (el.getAttribute("aria-label") || "")
        .toLowerCase()
        .startsWith(input.tab ?? ""),
    )
    if (!tab || tab.getAttribute("aria-selected") !== "true") return false
  }
  const info = document.querySelector(
    "tsl-pagination-actions .PaginationActions__info",
  )
  const text = (info?.textContent ?? "").replace(/\s+/g, " ").trim()
  const match = text.match(/(\d+)\s*-\s*(\d+)\s*de\s*(\d+)/i)
  if (!match) return false
  const from = Number(match[1])
  const to = Number(match[2])
  const total = Number(match[3])
  const rows = document.querySelectorAll('tr[id^="CatalogItem_"]').length
  if (total === 0) return rows === 0
  if (rows !== to - from + 1) return false
  if (input.previousPager && text === input.previousPager) return false
  const first = document.querySelector(
    'tr[id^="CatalogItem_"] a[href*="/item/"]',
  )
  if (input.previousHref && first instanceof Anchor) {
    return first.href !== input.previousHref
  }
  return true
}

async function waitForListedPage(
  page: Page,
  expected: CatalogPageExpect,
): Promise<void> {
  await page
    .waitForFunction(catalogPageSettled, expected, { timeout: PAGE_WAIT_MS })
    .catch(() => {})
}

function pageIsListed(shot: PageShot, totalHint: number | null): boolean {
  if (totalHint === 0) return shot.rows.length === 0
  const parsed = parseProPager(shot.pager)
  if (!parsed) return false
  if (parsed.total === 0) return shot.rows.length === 0
  return shot.rows.length === parsed.to - parsed.from + 1
}

async function selectedTabLabel(page: Page): Promise<string | null> {
  return (await page.evaluate(
    `(() => {
      const tab = document.querySelector("wallapop-tab[aria-selected='true']")
      return tab ? tab.getAttribute("aria-label") : null
    })()`,
  )) as string | null
}

async function openTab(page: Page, prefix: string): Promise<void> {
  const before = await readShot(page)
  const label = await selectedTabLabel(page)
  const already =
    label?.toLowerCase().startsWith(prefix.toLowerCase()) &&
    pageIsListed(before, parseProPager(before.pager)?.total ?? null)
  if (already) return
  await page.evaluate(clickTabEval(prefix))
  await waitForListedPage(page, {
    tab: prefix,
    previousPager: before.pager,
    previousHref: before.rows[0]?.href,
  })
}

async function readAllPages(
  page: Page,
  tab: string,
): Promise<{ rows: PublishedCatalogRow[]; total: number | null } | null> {
  await openTab(page, tab)
  const seen = new Map<string, PublishedCatalogRow>()
  let total: number | null = null
  let pager = ""
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const shot = await readShot(page)
    pager = shot.pager
    const parsed = parseProPager(pager)
    if (parsed) total = parsed.total
    for (const row of shot.rows) {
      if (!seen.has(row.href)) seen.set(row.href, row)
    }
    if (total != null && seen.size >= total) break
    const moved = await page.evaluate(CLICK_NEXT_EVAL)
    if (!moved) break
    await waitForListedPage(page, {
      previousPager: pager,
      previousHref: shot.rows[0]?.href,
    })
  }
  if (total == null || seen.size < total) {
    log("warn", "wallapop_monitor_pro_incomplete", {
      tab,
      collected: seen.size,
      total,
      pager,
    })
    return null
  }
  log("info", "wallapop_monitor_pro_tab", {
    tab,
    rows: seen.size,
    total,
    reserved: [...seen.values()].filter((row) => row.reserved).length,
  })
  return { rows: [...seen.values()], total }
}

export async function scrapeProCatalogs(page: Page): Promise<{
  published: PublishedCatalogRow[]
  sold: SoldCatalogRow[]
} | null> {
  const activos = await readAllPages(page, "Activos")
  if (!activos) return null
  const vendidos = await readAllPages(page, "Vendidos")
  if (!vendidos) return null
  const inactivos = await readAllPages(page, "Inactivos")
  if (!inactivos) return null
  return {
    published: activos.rows,
    sold: vendidos.rows.map((row) => ({ href: row.href, sold: true })),
  }
}
