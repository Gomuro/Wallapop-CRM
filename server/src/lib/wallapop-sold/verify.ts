import type { Page } from "playwright"

import { wallapopItemPathKey } from "../../../../lib/inventory/wallapop-item-url"
import { log } from "../log"

export type SoldCatalogRow = {
  href: string
  sold: boolean
}

/** First Vendidos row — live CDP + HTML fixtures. */
export const SOLD_CATALOG_ROWS_EVAL = `(() => {
  const rows = [...document.querySelectorAll("tsl-catalog-item")];
  return rows.map((el) => {
    const content = el.querySelector(".CatalogItem__content");
    const link = el.querySelector('a[href*="/item/"]');
    const badge = el.querySelector('wallapop-badge[badgetype="sold"]');
    return {
      href: link && "href" in link ? String(link.href) : "",
      sold:
        Boolean(badge) ||
        Boolean(content && content.classList.contains("CatalogItem__content--sold")),
    };
  });
})()`

export function firstSoldCatalogHrefMatches(
  rows: SoldCatalogRow[],
  wantedUrl: string,
): boolean {
  const wanted = wallapopItemPathKey(wantedUrl)
  if (!wanted) return false
  const first = rows.find((row) => wallapopItemPathKey(row.href) != null)
  if (!first || !first.sold) return false
  return wallapopItemPathKey(first.href) === wanted
}

export async function scrapeSoldCatalogRows(
  page: Page,
): Promise<SoldCatalogRow[]> {
  try {
    return ((await page.evaluate(SOLD_CATALOG_ROWS_EVAL)) as SoldCatalogRow[]) ?? []
  } catch (error) {
    log("warn", "wallapop_sold_catalog_scrape_failed", {
      message: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

export async function vendidosFirstRowMatches(
  page: Page,
  itemUrl: string,
): Promise<boolean> {
  const rows = await scrapeSoldCatalogRows(page)
  const ok = firstSoldCatalogHrefMatches(rows, itemUrl)
  log(ok ? "info" : "warn", "wallapop_sold_vendidos_verify", {
    ok,
    scanned: rows.length,
    firstHref: rows[0]?.href ?? null,
  })
  return ok
}
