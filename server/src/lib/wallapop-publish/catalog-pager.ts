import type { Page } from "playwright";

import { wallapopItemUrlOrNull } from "../../../../lib/inventory/wallapop-item-url";
import type { PublishedCatalogItem } from "./types";

const PRO_PAGE_CAP = 20;
const PRO_PAGE_WAIT_MS = 8_000;

const PRO_PAGER_EVAL = `(() => {
  const info = document.querySelector("tsl-pagination-actions .PaginationActions__info");
  return info ? String(info.textContent || "").replace(/\\s+/g, " ").trim() : "";
})()`;

const PRO_NEXT_EVAL = `(() => {
  const host = document.querySelector("tsl-pagination-actions");
  if (!host) return false;
  const icons = [...host.querySelectorAll("walla-icon.PaginationActions__action")];
  const next = icons[icons.length - 1];
  if (!next || next.classList.contains("PaginationActions__action--disabled")) return false;
  next.click();
  return true;
})()`;

export function proPagerHasMore(text: string): boolean {
  const match = text.replace(/\s+/g, " ").trim().match(/(\d+)\s*-\s*(\d+)\s*de\s*(\d+)/i);
  if (!match) return false;
  return Number(match[2]) < Number(match[3]);
}

export async function readProPager(page: Page): Promise<string> {
  try {
    return String((await page.evaluate(PRO_PAGER_EVAL)) ?? "");
  } catch {
    return "";
  }
}

/** Current Pro page is only ~40 rows. Walk the pager until the title can be matched. */
export async function collectProCatalogPages(
  page: Page,
  readRows: (page: Page) => Promise<PublishedCatalogItem[]>,
): Promise<PublishedCatalogItem[]> {
  const seen = new Map<string, PublishedCatalogItem>();
  let previousPager = "";
  for (let pageIndex = 0; pageIndex < PRO_PAGE_CAP; pageIndex += 1) {
    const rows = await readRows(page);
    for (const row of rows) {
      const href = wallapopItemUrlOrNull(row.href);
      if (!href || seen.has(href)) continue;
      seen.set(href, row);
    }
    const pager = await readProPager(page);
    if (pageIndex > 0 && pager && pager === previousPager) break;
    previousPager = pager;
    let moved = false;
    try {
      moved = Boolean(await page.evaluate(PRO_NEXT_EVAL));
    } catch {
      break;
    }
    if (!moved) break;
    await page
      .waitForFunction(
        `(() => {
          const prev = ${JSON.stringify(pager)};
          const info = document.querySelector("tsl-pagination-actions .PaginationActions__info");
          const text = info ? String(info.textContent || "").replace(/\\s+/g, " ").trim() : "";
          return Boolean(text) && text !== prev;
        })()`,
        { timeout: PRO_PAGE_WAIT_MS },
      )
      .catch(() => {});
  }
  return [...seen.values()];
}
