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
  firstRowChangedEval,
  listedPageReadyEval,
  parseProPager,
} from "./pro-catalog-eval"
import { logProPage, saveIncompleteActivos } from "./pro-catalog-diag"

const MAX_PAGES = 20
const DEFAULT_WAITS = {
  /** What tab switches and Next really waited so far (the old 8 s never applied, see below). */
  page: 30_000,
  /** Second, longer wait when the page after Next still shows the rows we already have. */
  staleRetry: 15_000,
}
let waits = DEFAULT_WAITS

/** Tests shorten the waits; null restores them. */
export function setProPageWaitsForTests(next: typeof DEFAULT_WAITS | null): void {
  waits = next ?? DEFAULT_WAITS
}
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

async function waitForListedPage(
  page: Page,
  expected: { tab?: string; previousPager?: string; previousHref?: string },
): Promise<void> {
  await page
    // Options are the third argument; as the second they were the page arg and the 30 s default applied.
    .waitForFunction(listedPageReadyEval(expected), undefined, { timeout: waits.page })
    .catch(() => {})
}

/** A page after Next that only shows rows we already have has not loaded yet. */
function hasNewRows(shot: PageShot, seen: Map<string, ProCatalogRow>): boolean {
  return shot.rows.some((row) => !seen.has(row.href))
}

/**
 * The page Next led to, once its own rows are there. The pager text can change before
 * the rows do, so a page with only known rows gets one longer wait and a second read.
 * Null: it never loaded, and reading on would skip a whole page.
 */
async function nextFreshShot(
  page: Page,
  previous: PageShot,
  seen: Map<string, ProCatalogRow>,
): Promise<PageShot | null> {
  await waitForListedPage(page, { previousPager: previous.pager, previousHref: previous.rows[0]?.href })
  const shot = await readShot(page)
  if (hasNewRows(shot, seen)) return shot
  await page
    .waitForFunction(firstRowChangedEval(previous.rows[0]?.href), undefined, { timeout: waits.staleRetry, polling: 250 })
    .catch(() => {})
  const retried = await readShot(page)
  return hasNewRows(retried, seen) ? retried : null
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

/**
 * The pager total is not stable within one pass (e.g. "de 501" on one page and "de 512"
 * on another with 512 ads), so the pass must reach the largest total it was shown.
 */
function largerTotal(total: number | null, pager: string): number | null {
  const parsed = parseProPager(pager)
  if (!parsed) return total
  return total == null ? parsed.total : Math.max(total, parsed.total)
}

/** Adds the page's rows; returns how many were not seen before. */
function absorbShot(seen: Map<string, ProCatalogRow>, shot: PageShot): number {
  const before = seen.size
  for (const row of shot.rows) {
    if (!seen.has(row.href)) seen.set(row.href, row)
  }
  return seen.size - before
}

async function collectProPages(
  page: Page,
  tab: string,
): Promise<{ seen: Map<string, ProCatalogRow>; total: number | null; pager: string }> {
  const seen = new Map<string, ProCatalogRow>()
  let total: number | null = null
  let shot: PageShot | null = await readShot(page)
  let pager = shot.pager
  for (let i = 0; i < MAX_PAGES && shot; i += 1) {
    pager = shot.pager
    total = largerTotal(total, pager)
    logProPage(tab, i + 1, shot, absorbShot(seen, shot))
    if (total != null && seen.size >= total) break
    const moved = await page.evaluate(CLICK_NEXT_EVAL)
    if (!moved) break
    const previous: PageShot = shot
    shot = await nextFreshShot(page, previous, seen)
    if (!shot) log("warn", "wallapop_monitor_pro_page_stale", { page: i + 2, pager: previous.pager })
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
  const { seen, total, pager } = await collectProPages(page, tab)
  if (proCatalogIncomplete(total, seen.size)) {
    const snapshot = tab === "Activos" ? await saveIncompleteActivos(page, { collected: seen.size, total }) : null
    log("warn", "wallapop_monitor_pro_incomplete", {
      tab,
      collected: seen.size,
      total,
      pager,
      snapshot,
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
  const { seen, total } = await collectProPages(page, "Activos")
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
