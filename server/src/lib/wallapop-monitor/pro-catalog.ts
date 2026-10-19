import type { Page } from "playwright"

import { wallapopItemPathKey } from "../../../../lib/inventory/wallapop-item-url"
import { log } from "../log"
import type { PublishedCatalogRow } from "./catalog"
import type { SoldCatalogRow } from "./diff"

const MAX_PAGES = 20
const PAGE_WAIT_MS = 8_000
/** Activos can still show the pre-publish table after the pager already matches. */
const ACTIVOS_ROW_WAIT_MS = 45_000
const CATALOG_SWITCH_WAIT_MS = 15_000
const TODO_CATALOG_LABEL = "todo el catálogo"

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

/** Pro table row. A sale is only `badgetype="sold"`, the same badge as the classic Vendidos list. */
export const PRO_CATALOG_ROWS_EVAL = `(() => {
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
    let sold = false
    walk(row, (node) => {
      if (
        !href &&
        node.tagName === "A" &&
        String(node.href || "").includes("/item/")
      ) {
        href = String(node.href)
      }
      if (node.tagName !== "WALLAPOP-BADGE") return
      const kind = node.getAttribute("badgetype")
      if (kind === "reserved") reserved = true
      if (kind === "sold") sold = true
    })
    if (href) rows.push({ href, reserved, sold })
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

type ProCatalogRow = PublishedCatalogRow & { sold: boolean }

type PageShot = {
  rows: ProCatalogRow[]
  pager: string
}

type CatalogChoice = {
  hasSwitcher: boolean
  label: string
  selected: string
}

function isFullCatalogUrl(url: string): boolean {
  try {
    return new URL(url).pathname.replace(/\/$/, "") === "/app/catalog/management"
  } catch {
    return false
  }
}

function choiceIsTodo(choice: CatalogChoice, url: string): boolean {
  const blob = `${choice.label} ${choice.selected}`.toLowerCase()
  return blob.includes(TODO_CATALOG_LABEL) && isFullCatalogUrl(url)
}

/**
 * Pro accounts keep two lists. The trigger is the light-DOM
 * `[aria-label^="Catálogo seleccionado"]` (`div.walla-dropdown__inner-input`).
 * Options are `walla-dropdown-item` inside that dropdown, including shadow.
 * "Suscripción Multicategoría" is consumer goods only. "Todo el catálogo" is
 * the full list. The selected value sticks, so opening `/catalog/management`
 * still lands on `/consumergoods` until this item is clicked.
 */
export async function ensureTodoElCatalogo(page: Page): Promise<boolean> {
  const before = await readCatalogChoice(page)
  if (!before.hasSwitcher) {
    const ok = isFullCatalogUrl(page.url())
    log("info", "wallapop_monitor_catalog_switch", {
      skipped: true,
      reason: "no_switcher",
      url: page.url(),
      ok,
    })
    return ok
  }
  if (choiceIsTodo(before, page.url())) {
    log("info", "wallapop_monitor_catalog_switch", {
      already: true,
      label: before.label,
      url: page.url(),
    })
    return true
  }

  let result: "clicked" | "missing" = "missing"
  for (let attempt = 0; attempt < 3 && result === "missing"; attempt += 1) {
    result = await clickTodoCatalogItem(page)
    if (result === "missing") await page.waitForTimeout(400)
  }

  try {
    await page.waitForFunction(
      `(() => {
        const path = location.pathname.replace(/\\/$/, "")
        if (path !== "/app/catalog/management") return false
        const button = document.querySelector('[aria-label^="Catálogo seleccionado"]')
        const label = button ? button.getAttribute("aria-label") || "" : ""
        return label.toLowerCase().includes(${JSON.stringify(TODO_CATALOG_LABEL)})
      })()`,
      { timeout: CATALOG_SWITCH_WAIT_MS },
    )
  } catch {
    const after = await readCatalogChoice(page)
    log("warn", "wallapop_monitor_catalog_switch_failed", {
      result,
      from: before.label,
      label: after.label,
      url: page.url(),
    })
    return false
  }

  log("info", "wallapop_monitor_catalog_switch", {
    from: before.label,
    url: page.url(),
  })
  return true
}

const READ_CATALOG_CHOICE_EVAL = `(() => {
  function walk(root, visit) {
    if (!root || !root.querySelectorAll) return
    root.querySelectorAll("*").forEach((el) => {
      visit(el)
      if (el.shadowRoot) walk(el.shadowRoot, visit)
    })
  }
  function textOf(el) {
    let text = ""
    walk(el, (node) => {
      if (text || !node.childNodes) return
      node.childNodes.forEach((child) => {
        if (child.nodeType === 3 && String(child.textContent || "").trim()) {
          text = String(child.textContent).trim()
        }
      })
    })
    return text || String(el.textContent || "").replace(/\\s+/g, " ").trim()
  }
  const button = document.querySelector('[aria-label^="Catálogo seleccionado"]')
  let selected = ""
  walk(document, (el) => {
    if (selected || el.tagName !== "WALLA-DROPDOWN-ITEM") return
    if (el.getAttribute("aria-selected") !== "true") return
    selected = textOf(el)
  })
  return {
    hasSwitcher: Boolean(button),
    label: button ? button.getAttribute("aria-label") || "" : "",
    selected,
  }
})()`

const CLICK_TODO_CATALOG_EVAL = `(() => {
  const wanted = ${JSON.stringify(TODO_CATALOG_LABEL)}
  function walk(root, visit) {
    if (!root || !root.querySelectorAll) return
    root.querySelectorAll("*").forEach((el) => {
      visit(el)
      if (el.shadowRoot) walk(el.shadowRoot, visit)
    })
  }
  function textOf(el) {
    let text = ""
    walk(el, (node) => {
      if (text || !node.childNodes) return
      node.childNodes.forEach((child) => {
        if (child.nodeType === 3 && String(child.textContent || "").trim()) {
          text = String(child.textContent).trim()
        }
      })
    })
    return text || String(el.textContent || "").replace(/\\s+/g, " ").trim()
  }
  const button = document.querySelector('[aria-label^="Catálogo seleccionado"]')
  if (button && button.getAttribute("aria-expanded") !== "true") button.click()
  let target = null
  walk(document, (el) => {
    if (target || el.tagName !== "WALLA-DROPDOWN-ITEM") return
    if (textOf(el).toLowerCase() !== wanted) return
    target = el
  })
  if (!target) return "missing"
  target.click()
  return "clicked"
})()`

async function readCatalogChoice(page: Page): Promise<CatalogChoice> {
  return (await page.evaluate(READ_CATALOG_CHOICE_EVAL)) as CatalogChoice
}

async function clickTodoCatalogItem(
  page: Page,
): Promise<"clicked" | "missing"> {
  return (await page.evaluate(CLICK_TODO_CATALOG_EVAL)) as "clicked" | "missing"
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
  const shot = (await page.evaluate(PRO_CATALOG_ROWS_EVAL)) as PageShot | null
  return { rows: shot?.rows ?? [], pager: shot?.pager ?? "" }
}

async function waitForListedPage(
  page: Page,
  expected: { tab?: string; previousPager?: string; previousHref?: string },
): Promise<void> {
  await page
    .waitForFunction(
      (input) => {
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
        if (input.previousHref && first instanceof HTMLAnchorElement) {
          return first.href !== input.previousHref
        }
        return true
      },
      expected,
      { timeout: PAGE_WAIT_MS },
    )
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
    await page.waitForFunction(
      (needles: string[]) => {
        function walk(root: ParentNode, visit: (el: Element) => void) {
          root.querySelectorAll("*").forEach((el) => {
            visit(el)
            if (el.shadowRoot) walk(el.shadowRoot, visit)
          })
        }
        const need = new Set(needles)
        walk(document, (node) => {
          if (node.tagName !== "A") return
          const href = (node as HTMLAnchorElement).href
          if (!href) return
          try {
            const path = new URL(href).pathname.replace(/\/$/, "").toLowerCase()
            if (need.has(path)) need.delete(path)
          } catch {
            /* ignore bad hrefs */
          }
        })
        return need.size === 0
      },
      needles,
      { timeout: ACTIVOS_ROW_WAIT_MS, polling: 1_000 },
    )
    return true
  } catch {
    return false
  }
}

async function readAllPages(
  page: Page,
  tab: string,
  confirmHrefs?: string[],
): Promise<{ rows: PublishedCatalogRow[]; total: number | null } | null> {
  await openTab(page, tab)
  if (tab === "Activos" && confirmHrefs && confirmHrefs.length > 0) {
    const appeared = await waitForActivosHrefs(page, confirmHrefs)
    log("info", "wallapop_monitor_activos_wait", {
      hrefs: confirmHrefs.length,
      appeared,
    })
  }
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
  if (total == null || seen.size < total) {
    log("warn", "wallapop_monitor_pro_incomplete", {
      tab,
      collected: seen.size,
      total,
      pager,
    })
    return null
  }
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
  return { rows: [...seen.values()], total }
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
