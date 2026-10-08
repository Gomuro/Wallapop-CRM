import type { Page } from "playwright";

import { wallapopItemUrlOrNull } from "../../../../lib/inventory/wallapop-item-url";
import { log } from "../log";
import {
  normalizePublishTitle,
  truncateSummary,
  type PublishedCatalogItem,
  type PublishLandingVerdict,
} from "./types";

const CATALOG_URL_POLL_MS = 150;
const CATALOG_URL_TIMEOUT_MS = 3_000;

/** Same scrape as live CDP — used in tests against captured Tu Catálogo HTML. */
export const PUBLISHED_CATALOG_ITEMS_EVAL = `(() => {
  const rows = [...document.querySelectorAll("tsl-catalog-item")];
  return rows.map((el) => {
    const group = el.querySelector("[role=group]");
    const titleEl = el.querySelector("span.info-title");
    const priceEl = el.querySelector("span.info-price");
    const link = el.querySelector('a[href*="/item/"]');
    return {
      title: (titleEl?.textContent || group?.getAttribute("aria-label") || "").trim(),
      href: link && "href" in link ? String(link.href) : "",
      priceText: (priceEl?.textContent || "").trim(),
    };
  });
})()`;

const DISMISS_YUHU_EVAL = `(() => {
  const modal = document.querySelector(
    "tsl-bump-suggestion-modal, walla-dialog.BumpSuggestionModal",
  );
  if (!modal) return "absent";
  const labelOf = (el) => {
    const shadowBtn = el.shadowRoot?.querySelector?.("button");
    return (
      el.innerText ||
      el.getAttribute("aria-label") ||
      el.getAttribute("text") ||
      shadowBtn?.innerText ||
      shadowBtn?.getAttribute("aria-label") ||
      ""
    )
      .trim()
      .replace(/\\s+/g, " ");
  };
  const nodes = [...document.querySelectorAll("button, [role=button], walla-button")];
  for (const el of nodes) {
    if (!/Ahora no,? gracias/i.test(labelOf(el))) continue;
    const target = el.shadowRoot?.querySelector?.("button") || el;
    target.click();
    return "dismissed";
  }
  const close = document.querySelector('button[aria-label="Close"]');
  if (close) {
    close.click();
    return "dismissed";
  }
  return "present";
})()`;

export function parseCatalogPriceEur(text: string): number | null {
  const compact = text.replace(/\u00a0/g, " ").replace(/[^\d,.\-]/g, "");
  if (!compact) return null;
  const normalized = compact.includes(",")
    ? compact.replace(/\./g, "").replace(",", ".")
    : compact;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export function catalogTitleMatchesWanted(
  catalogTitle: string,
  crmTitle: string,
): boolean {
  const catalog = normalizePublishTitle(catalogTitle);
  const wanted = normalizePublishTitle(crmTitle);
  if (!catalog || !wanted) return false;
  if (catalog === wanted) return true;
  const summary = truncateSummary(wanted);
  if (catalog === summary) return true;
  const stripped = catalog.replace(/[.…]+$/u, "").trim();
  if (stripped.length < 12) return false;
  return wanted.startsWith(stripped) || summary.startsWith(stripped);
}

export function pickUniqueCatalogItemUrl(
  items: PublishedCatalogItem[],
  wanted: { title: string; price: number },
): {
  href: string | null;
  reason: "matched" | "matched_price" | "none" | "ambiguous";
} {
  const matches = items.filter(
    (row) =>
      wallapopItemUrlOrNull(row.href) != null &&
      catalogTitleMatchesWanted(row.title, wanted.title),
  );
  if (matches.length === 0) return { href: null, reason: "none" };
  if (matches.length === 1) {
    return {
      href: wallapopItemUrlOrNull(matches[0].href),
      reason: "matched",
    };
  }
  const byPrice = matches.filter((row) => {
    const price = parseCatalogPriceEur(row.priceText);
    return price != null && Math.abs(price - wanted.price) < 0.009;
  });
  if (byPrice.length === 1) {
    return {
      href: wallapopItemUrlOrNull(byPrice[0].href),
      reason: "matched_price",
    };
  }
  return { href: null, reason: "ambiguous" };
}

/** Right after Publicar the new row is first ~98% of the time. Grab it immediately. */
export function firstCatalogItemUrl(
  items: PublishedCatalogItem[],
): string | null {
  for (const row of items) {
    const href = wallapopItemUrlOrNull(row.href);
    if (href) return href;
  }
  return null;
}

export async function scrapePublishedCatalogItems(
  page: Page,
): Promise<PublishedCatalogItem[]> {
  try {
    return (
      ((await page.evaluate(PUBLISHED_CATALOG_ITEMS_EVAL)) as
        | PublishedCatalogItem[]
        | null) ?? []
    );
  } catch (error) {
    log("warn", "wallapop_publish_catalog_scrape_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export async function grabCatalogItemUrl(
  page: Page,
  wanted: { title: string; price: number },
  timeoutMs = CATALOG_URL_TIMEOUT_MS,
): Promise<{
  href: string | null;
  reason: "first_row" | "matched" | "matched_price" | "none" | "ambiguous";
  scanned: number;
}> {
  const deadline = Date.now() + timeoutMs;
  let rows: PublishedCatalogItem[] = [];
  while (true) {
    rows = await scrapePublishedCatalogItems(page);
    const first = firstCatalogItemUrl(rows);
    if (first) {
      return { href: first, reason: "first_row", scanned: rows.length };
    }
    if (Date.now() >= deadline) break;
    await page.waitForTimeout(CATALOG_URL_POLL_MS);
  }
  const picked = pickUniqueCatalogItemUrl(rows, wanted);
  return { href: picked.href, reason: picked.reason, scanned: rows.length };
}

export async function dismissYuhuModal(page: Page): Promise<void> {
  try {
    const result = (await page.evaluate(DISMISS_YUHU_EVAL)) as string;
    log("info", "wallapop_publish_yuhu", { result });
  } catch (error) {
    log("warn", "wallapop_publish_yuhu_dismiss_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function resolveItemUrlAfterPublish(
  page: Page,
  landing: Extract<PublishLandingVerdict, { ok: true }>,
  landingUrl: string | null,
  wanted: { title: string; price: number },
): Promise<string | null> {
  if (landing.reason === "item_url") {
    return wallapopItemUrlOrNull(landingUrl ?? "");
  }
  const grabbed = await grabCatalogItemUrl(page, wanted);
  log(
    grabbed.href ? "info" : "warn",
    grabbed.href
      ? "wallapop_publish_item_url"
      : "wallapop_publish_item_url_unresolved",
    { reason: grabbed.reason, href: grabbed.href, scanned: grabbed.scanned },
  );
  await dismissYuhuModal(page);
  return grabbed.href;
}
