import type { Page } from "playwright"

import { wallapopItemPathKey } from "../../../../lib/inventory/wallapop-item-url"
import { log } from "../log"
import type { PublishedCatalogRow } from "./catalog"
import type { SoldCatalogRow } from "./diff"
import {
  CLICK_NEXT_EVAL,
  CLICK_PREV_EVAL,
  PRO_CATALOG_ROWS_EVAL,
  clickTabEval,
  parseProPager,
} from "./pro-catalog-eval"

const MAX_PAGES = 20
const PAGE_WAIT_MS = 8_000
/** Activos can still show the pre-publish table after the pager already matches. */
const ACTIVOS_ROW_WAIT_MS = 45_000

type ProCatalogRow = PublishedCatalogRow & {
  sold: boolean
  title: string
  priceText: string
}

export type ProActivosSnapshot = {
  rows: ProCatalogRow[]
  total: number | null
  complete: boolean
}

type PageShot = {
  rows: ProCatalogRow[]
  pager: string
}

async function readShot(page: Page): Promise<PageShot> {
  const shot = (await page.evaluate(PRO_CATALOG_ROWS_EVAL)) as PageShot | null
  return { rows: shot?.rows ?? [], pager: shot?.pager ?? "" }
}

function listedPageReadyEval(input: {
  tab?: string
  previousPager?: string
  previousHref?: string
}): string {
  return `(() => {
    const input = ${JSON.stringify(input)}
    if (input.tab) {
      const tab = [...document.querySelectorAll("wallapop-tab")].find((el) =>
        (el.getAttribute("aria-label") || "")
          .toLowerCase()
          .startsWith(input.tab || ""),
      )
      if (!tab || tab.getAttribute("aria-selected") !== "true") return false
    }
    const info = document.querySelector(
      "tsl-pagination-actions .PaginationActions__info",
    )
    const text = (info && info.textContent ? info.textContent : "").replace(/\\s+/g, " ").trim()
    const match = text.match(/(\\d+)\\s*-\\s*(\\d+)\\s*de\\s*(\\d+)/i)
    if (!match) return false
    const from = Number(match[1])
    const to = Number(match[2])
    const total = Number(match[3])
    const rows = document.querySelectorAll('tr[id^="CatalogItem_"]').length
    if (total === 0) return rows === 0
    if (rows !== to - from + 1) return false
    if (input.previousPager && text === input.previousPager) return false
    const first = document.querySelector('tr[id^="CatalogItem_"] a[href*="/item/"]')
    if (input.previousHref && first instanceof HTMLAnchorElement) {
      return first.href !== input.previousHref
    }
    return true
  })()`
}

async function waitForListedPage(
  page: Page,
  expected: { tab?: string; previousPager?: string; previousHref?: string },
): Promise<void> {
  await page
    .waitForFunction(listedPageReadyEval(expected), { timeout: PAGE_WAIT_MS })
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
  const listed = pageIsListed(before, parseProPager(before.pager)?.total ?? null)
  const already =
    label?.toLowerCase().startsWith(prefix.toLowerCase()) && listed
  if (already) return
  const clicked = Boolean(await page.evaluate(clickTabEval(prefix)))
  if (!clicked) return
  await waitForListedPage(page, {
    tab: prefix,
    previousPager: before.pager,
    previousHref: before.rows[0]?.href,
  })
}

async function rewindToFirstProPage(page: Page): Promise<void> {
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const shot = await readShot(page)
    const parsed = parseProPager(shot.pager)
    if (!parsed || parsed.from <= 1) return
    const moved = Boolean(await page.evaluate(CLICK_PREV_EVAL))
    if (!moved) return
    await waitForListedPage(page, {
      previousPager: shot.pager,
      previousHref: shot.rows[0]?.href,
    })
  }
}

function activosRowsContainEval(needles: string[]): string {
  return `(() => {
    const needles = ${JSON.stringify(needles)}
    function walk(root, visit) {
      if (!root || !root.querySelectorAll) return
      root.querySelectorAll("*").forEach((el) => {
        visit(el)
        if (el.shadowRoot) walk(el.shadowRoot, visit)
      })
    }
    const need = new Set(needles)
    walk(document, (node) => {
      if (node.tagName !== "A") return
      const href = node.href
      if (!href) return
      try {
        const path = new URL(href).pathname.replace(/\\/$/, "").toLowerCase()
        if (need.has(path)) need.delete(path)
      } catch (error) {}
    })
    return need.size === 0
  })()`
}

export async function waitForActivosHrefs(
  page: Page,
  hrefs: string[],
): Promise<boolean> {
  const needles = [
    ...new Set(
      hrefs
        .map((href) => wallapopItemPathKey(href))
        .filter((key): key is string => key != null),
    ),
  ]
  if (needles.length === 0) return false
  try {
    await page.waitForFunction(activosRowsContainEval(needles), {
      timeout: ACTIVOS_ROW_WAIT_MS,
      polling: 1_000,
    })
    return true
  } catch {
    return false
  }
}

async function confirmActivosIfNeeded(
  page: Page,
  tab: string,
  confirmHrefs?: string[],
): Promise<void> {
  if (tab !== "Activos" || !confirmHrefs || confirmHrefs.length === 0) return
  const appeared = await waitForActivosHrefs(page, confirmHrefs)
  log("info", "wallapop_monitor_activos_wait", {
    hrefs: confirmHrefs.length,
    appeared,
  })
}

function proCatalogIncomplete(total: number | null, collected: number): boolean {
  return total == null || collected < total
}

function logProTab(
  tab: string,
  seen: Map<string, ProCatalogRow>,
  total: number | null,
): void {
  const values = [...seen.values()]
  log("info", "wallapop_monitor_pro_tab", {
    tab,
    rows: seen.size,
    total,
    reserved: values.filter((row) => row.reserved).length,
    ...(tab === "Vendidos"
      ? { soldBadges: values.filter((row) => row.sold).length }
      : {}),
  })
}

async function collectProPages(
  page: Page,
): Promise<{ seen: Map<string, ProCatalogRow>; total: number | null; pager: string }> {
  const seen = new Map<string, ProCatalogRow>()
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
  return { seen, total, pager }
}

async function readAllPages(
  page: Page,
  tab: string,
  confirmHrefs?: string[],
): Promise<{ rows: ProCatalogRow[]; total: number | null } | null> {
  await openTab(page, tab)
  await confirmActivosIfNeeded(page, tab, confirmHrefs)
  const { seen, total, pager } = await collectProPages(page)
  if (proCatalogIncomplete(total, seen.size)) {
    log("warn", "wallapop_monitor_pro_incomplete", {
      tab,
      collected: seen.size,
      total,
      pager,
    })
    return null
  }
  logProTab(tab, seen, total)
  return { rows: [...seen.values()], total }
}

/** Activos, every pager page. `complete` is false when the pager total was not reached. */
export async function scrapeProActivos(page: Page): Promise<ProActivosSnapshot> {
  await rewindToFirstProPage(page)
  await openTab(page, "Activos")
  const { seen, total } = await collectProPages(page)
  return {
    rows: [...seen.values()],
    total,
    complete: !proCatalogIncomplete(total, seen.size),
  }
}

export async function scrapeProCatalogs(
  page: Page,
  confirmHrefs?: string[],
): Promise<{
  published: PublishedCatalogRow[]
  sold: SoldCatalogRow[]
} | null> {
  const activos = await readAllPages(page, "Activos", confirmHrefs)
  if (!activos) return null
  const vendidos = await readAllPages(page, "Vendidos")
  if (!vendidos) return null
  const inactivos = await readAllPages(page, "Inactivos")
  if (!inactivos) return null
  return {
    published: activos.rows,
    sold: vendidos.rows
      .filter((row) => row.sold)
      .map((row) => ({ href: row.href, sold: true as const })),
  }
}
