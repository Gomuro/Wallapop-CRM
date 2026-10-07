import type { Page } from "playwright";

import { wallapopItemUrlOrNull } from "../../../../lib/inventory/wallapop-item-url";
import { log } from "../log";
import {
  PUBLICAR_SETTLE_MS,
  normalizePublishTitle,
  truncateSummary,
  type PageUrlReader,
  type PublishedCatalogItem,
  type PublishLandingVerdict,
} from "./types";

export { normalizePublishTitle };

export function listingUrlFromPageUrl(url: string): string | null {
  return wallapopItemUrlOrNull(url);
}

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
): { href: string | null; reason: "matched" | "matched_price" | "none" | "ambiguous" } {
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

export function isWallapopPublishedCatalogUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host !== "wallapop.com" && !host.endsWith(".wallapop.com")) return false;
    return /\/app\/catalog\/published(\/|$)/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function isWallapopUploadFormUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /\/upload(\/|$)/i.test(parsed.pathname);
  } catch {
    return /\/upload/i.test(url);
  }
}

/** D9: post exists only on Tu Catálogo published (or rare /item/ redirect). */
export function classifyPublishLanding(input: {
  url: string | null;
  urlReadFailed: boolean;
  reviewMessage: string | null;
}): PublishLandingVerdict {
  if (input.urlReadFailed || input.url == null || input.url.trim() === "") {
    return {
      ok: false,
      reason: "target_closed",
      message:
        "No se pudo comprobar el catálogo tras Publicar (pestaña cerrada). El listing no se marcó ACTIVE.",
    };
  }
  if (input.reviewMessage) {
    return {
      ok: false,
      reason: "review_banner",
      message: input.reviewMessage,
    };
  }
  if (isWallapopUploadFormUrl(input.url)) {
    return {
      ok: false,
      reason: "still_on_upload",
      message:
        "Wallapop no publicó el anuncio; el formulario de alta sigue abierto.",
    };
  }
  if (isWallapopPublishedCatalogUrl(input.url)) {
    return { ok: true, reason: "published_catalog" };
  }
  if (wallapopItemUrlOrNull(input.url)) {
    return { ok: true, reason: "item_url" };
  }
  return {
    ok: false,
    reason: "unexpected_url",
    message: `Tras Publicar la página no es el catálogo publicado (${input.url}). El listing no se marcó ACTIVE.`,
  };
}

/**
 * Playwright tore down the tab/context after (or during) in-page click.
 * Treat as posted: the DOM click may already have run; reverting would duplicate.
 */
export function isPublicarContextDestroyedError(error: unknown): boolean {
  const message = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase();
  return (
    message.includes("target closed") ||
    message.includes("execution context was destroyed") ||
    message.includes("page closed") ||
    (message.includes("protocol error") && message.includes("closed"))
  );
}

/**
 * After Publicar: wait, then read the landing URL.
 * Target closed → urlReadFailed (D9: not ACTIVE).
 */
export async function readLandingAfterPublicarClick(
  page: PageUrlReader,
  settleMs = PUBLICAR_SETTLE_MS,
): Promise<{ url: string | null; urlReadFailed: boolean }> {
  try {
    await page.waitForTimeout(settleMs);
    const url = page.url();
    return { url: url || null, urlReadFailed: !url };
  } catch (error) {
    log("warn", "wallapop_publish_url_after_publicar_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    if (isPublicarContextDestroyedError(error)) {
      return { url: null, urlReadFailed: true };
    }
    throw error;
  }
}

export async function readUrlAfterPublicarClick(
  page: PageUrlReader,
  settleMs = PUBLICAR_SETTLE_MS,
): Promise<string | null> {
  const landing = await readLandingAfterPublicarClick(page, settleMs);
  if (landing.urlReadFailed || landing.url == null) return null;
  return listingUrlFromPageUrl(landing.url);
}

async function readPublishedCatalogItems(
  page: Page,
): Promise<PublishedCatalogItem[]> {
  try {
    await page
      .locator("tsl-catalog-item a[href*='/item/']")
      .first()
      .waitFor({ timeout: 10_000 });
  } catch {
    log("warn", "wallapop_publish_catalog_items_missing");
  }
  try {
    return ((await page.evaluate(PUBLISHED_CATALOG_ITEMS_EVAL)) as
      | PublishedCatalogItem[]
      | null) ?? [];
  } catch (error) {
    log("warn", "wallapop_publish_catalog_scrape_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export async function resolveItemUrlAfterPublish(
  page: Page,
  landing: Extract<PublishLandingVerdict, { ok: true }>,
  landingUrl: string | null,
  wanted: { title: string; price: number },
): Promise<string | null> {
  if (landing.reason === "item_url") {
    return listingUrlFromPageUrl(landingUrl ?? "");
  }
  const rows = await readPublishedCatalogItems(page);
  const picked = pickUniqueCatalogItemUrl(rows, wanted);
  if (picked.href) {
    log("info", "wallapop_publish_item_url", {
      reason: picked.reason,
      href: picked.href,
      scanned: rows.length,
    });
    return picked.href;
  }
  log("warn", "wallapop_publish_item_url_unresolved", {
    reason: picked.reason,
    scanned: rows.length,
  });
  return null;
}

const UPLOAD_REVIEW_MESSAGE_EVAL = `(() => {
  const text = document.body ? document.body.innerText : "";
  if (/Revisa los campos/i.test(text) || /Revisa la información/i.test(text)) {
    return "Wallapop pidió revisar campos en rojo (Marca u otros). El anuncio no se publicó.";
  }
  if (/Campo obligatorio/i.test(text) && /Marca/i.test(text)) {
    return "Falta Marca en Wallapop. El anuncio no se publicó.";
  }
  return null;
})()`;

export async function wallapopUploadReviewMessage(
  page: Page,
): Promise<string | null> {
  try {
    return (await page.evaluate(UPLOAD_REVIEW_MESSAGE_EVAL)) as string | null;
  } catch {
    return null;
  }
}
