import type { Page } from "playwright"

import { log } from "../log"

import { PAGE_KIND_EVAL } from "./pro-catalog-eval"

export { parseProPager, PRO_CATALOG_ROWS_EVAL } from "./pro-catalog-eval"
export { ensureTodoElCatalogo } from "./pro-catalog-choice"
export { scrapeProActivos, scrapeProCatalogs, waitForActivosHrefs } from "./pro-catalog-pages"
export type { ProActivosSnapshot } from "./pro-catalog-pages"

export type CatalogKind = "pro" | "classic" | "unknown"

export type CatalogKindTiming = {
  /** How long to poll the page before one reload. */
  budgetMs: number
  pollMs: number
}

const DEFAULT_KIND_TIMING: CatalogKindTiming = { budgetMs: 30_000, pollMs: 500 }

async function readKindOnce(page: Page): Promise<CatalogKind> {
  try {
    const kind = (await page.evaluate(PAGE_KIND_EVAL)) as string
    return kind === "pro" || kind === "classic" ? kind : "unknown"
  } catch {
    // The catalog redirects (/management -> /consumergoods) while it loads.
    return "unknown"
  }
}

async function pollKind(page: Page, timing: CatalogKindTiming): Promise<CatalogKind> {
  const deadline = Date.now() + timing.budgetMs
  for (;;) {
    const kind = await readKindOnce(page)
    if (kind !== "unknown" || Date.now() >= deadline) return kind
    await page.waitForTimeout(timing.pollMs).catch(() => {})
  }
}

/**
 * Pro (Activos tab) or classic (catalog cards). The page can be slow behind
 * the proxy and redirects while loading, so it is polled, then reloaded once.
 */
export async function wallapopCatalogKind(
  page: Page,
  timing: CatalogKindTiming = DEFAULT_KIND_TIMING,
): Promise<CatalogKind> {
  const startedAt = Date.now()
  const first = await pollKind(page, timing)
  if (first !== "unknown") return first
  log("info", "wallapop_monitor_catalog_kind_reload", { url: page.url(), waitedMs: Date.now() - startedAt })
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {})
  return pollKind(page, timing)
}
