import type { Page } from "playwright";

import { wallapopItemUrlOrNull } from "../../../../lib/inventory/wallapop-item-url";
import { log } from "../log";
import { scrapeProActivos } from "../wallapop-monitor/pro-catalog";
import {
  normalizePublishTitle,
  truncateSummary,
  type PublishedCatalogItem,
  type PublishLandingVerdict,
} from "./types";

const CATALOG_URL_POLL_MS = 1_000;
/** Activos can still be the pre-publish table after the pager already matches. */
const CATALOG_URL_TIMEOUT_MS = 45_000;
/** Wallapop often paints the old total until the management page is reloaded. */
const CATALOG_RELOADS = 4;

/**
 * Pro catalog rows. Same host as the monitor (`tr[id^="CatalogItem_"]`).
 * Title is the name cell; price is the cell that contains €.
 */
export const PRO_CATALOG_ITEMS_EVAL = `(() => {
  function walk(root, visit) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll("*").forEach((el) => {
      visit(el);
      if (el.shadowRoot) walk(el.shadowRoot, visit);
    });
  }
  function text(el) {
    return String(el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim();
  }
  const rows = [];
  document.querySelectorAll('tr[id^="CatalogItem_"]').forEach((row) => {
    let href = "";
    walk(row, (node) => {
      if (!href && node.tagName === "A" && String(node.href || "").includes("/item/")) {
        href = String(node.href);
      }
    });
    const bits = [];
    row.querySelectorAll("td").forEach((td) => {
      const value = text(td);
      if (value) bits.push(value);
    });
    const priceText = bits.find((value) => /€/.test(value)) || "";
    let title =
      bits.find(
        (value) =>
          value !== priceText &&
          !/^\\d{1,2}\\/\\d{1,2}\\/\\d{4}/.test(value) &&
          !/^\\d+$/.test(value),
      ) || "";
    if (!title) {
      const input = row.querySelector("input[aria-label]");
      const aria = input ? String(input.getAttribute("aria-label") || "") : "";
      title = aria.replace(/^Select\\s+/i, "").trim();
    }
    rows.push({ title, href, priceText });
  });
  return rows;
})()`;

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

async function evaluateCatalogRows(
  page: Page,
  expression: string,
): Promise<PublishedCatalogItem[]> {
  try {
    return (
      ((await page.evaluate(expression)) as PublishedCatalogItem[] | null) ?? []
    );
  } catch (error) {
    log("warn", "wallapop_publish_catalog_scrape_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export async function scrapePublishedCatalogItems(
  page: Page,
): Promise<PublishedCatalogItem[]> {
  return evaluateCatalogRows(page, PUBLISHED_CATALOG_ITEMS_EVAL);
}

export async function scrapeProCatalogItems(
  page: Page,
): Promise<PublishedCatalogItem[]> {
  return evaluateCatalogRows(page, PRO_CATALOG_ITEMS_EVAL);
}

type CatalogGrab = {
  href: string | null;
  reason: "first_row" | "matched" | "matched_price" | "none" | "ambiguous";
  scanned: number;
};

export async function grabCatalogItemUrl(
  page: Page,
  wanted: { title: string; price: number },
  timeoutMs = CATALOG_URL_TIMEOUT_MS,
): Promise<CatalogGrab> {
  const deadline = Date.now() + timeoutMs;
  let classic: PublishedCatalogItem[] = [];
  let last: CatalogGrab = { href: null, reason: "none", scanned: 0 };
  let reloads = 0;
  while (true) {
    await dismissYuhuModal(page);
    const pro = await scrapeProCatalogItems(page);
    if (pro.length > 0) {
      const activos = await scrapeProActivos(page);
      const items = activos.rows.map((row) => ({
        title: row.title,
        href: row.href,
        priceText: row.priceText,
      }));
      const picked = pickUniqueCatalogItemUrl(items, wanted);
      last = { href: picked.href, reason: picked.reason, scanned: items.length };
      log("info", "wallapop_publish_catalog_scan", {
        rows: items.length,
        total: activos.total,
        complete: activos.complete,
        reason: picked.reason,
      });
      if (picked.href || picked.reason === "ambiguous") return last;
      if (
        activos.complete &&
        reloads < CATALOG_RELOADS &&
        Date.now() < deadline &&
        page.url().startsWith("http")
      ) {
        reloads += 1;
        log("info", "wallapop_publish_catalog_reload", {
          attempt: reloads,
          rows: items.length,
          total: activos.total,
        });
        await page
          .reload({ waitUntil: "domcontentloaded", timeout: 20_000 })
          .catch(() => {});
        await page
          .waitForSelector('tr[id^="CatalogItem_"]', { timeout: 15_000 })
          .catch(() => {});
        continue;
      }
    } else {
      classic = await scrapePublishedCatalogItems(page);
      const first = firstCatalogItemUrl(classic);
      if (first) {
        return { href: first, reason: "first_row", scanned: classic.length };
      }
    }
    if (Date.now() >= deadline) break;
    await page.waitForTimeout(CATALOG_URL_POLL_MS);
  }
  if (last.scanned > 0) return last;
  return { href: null, reason: "none", scanned: classic.length };
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
  return wallapopItemUrlOrNull(grabbed.href);
}
