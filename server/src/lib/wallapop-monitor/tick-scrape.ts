import type { Page } from "playwright";

import { log } from "../log";
import {
  dismissWallapopConsent,
  isLoginOr2faUrl,
  isWallapopLoggedOutUrl,
  navigateViaAssign,
} from "../wallapop-cdp";
import { gotoVendidosCatalog } from "../wallapop-sold/nav";
import { markWallapopSessionLoggedOut } from "../wallapop-session";
import { CATALOG_PUBLISHED_URL } from "./catalog";
import {
  ensureTodoElCatalogo,
  scrapeProCatalogs,
  wallapopCatalogKind,
} from "./pro-catalog";
import { closeProCatalogModal } from "./pro-catalog-modal";
import {
  scrapePublishedCatalogRows,
  scrapeVendidosCatalogRows,
  scrollCatalogUntilStable,
} from "./scrape";

async function leaveIfSessionBlocked(
  page: Page,
  accountId: string,
): Promise<boolean> {
  if (isWallapopLoggedOutUrl(page.url())) {
    log("info", "wallapop_monitor_logged_out", { url: page.url(), accountId });
    await markWallapopSessionLoggedOut(accountId);
    return true;
  }
  if (isLoginOr2faUrl(page.url())) {
    log("info", "wallapop_monitor_skip_login", { url: page.url() });
    return true;
  }
  return false;
}

async function scrapeProMonitor(page: Page, confirmHrefs?: string[]) {
  await closeProCatalogModal(page, "catalog");
  const onFullCatalog = await ensureTodoElCatalogo(page);
  if (!onFullCatalog) {
    log("warn", "wallapop_monitor_catalog_not_full", { url: page.url() });
    return null;
  }
  const pro = await scrapeProCatalogs(page, confirmHrefs);
  if (!pro) return null;
  log("info", "wallapop_monitor_published_scanned", {
    rows: pro.published.length,
    reserved: pro.published.filter((row) => row.reserved).length,
    scrolledItems: pro.published.length,
    url: page.url(),
    mode: "pro",
  });
  log("info", "wallapop_monitor_sold_scanned", {
    rows: pro.sold.length,
    sold: pro.sold.length,
    scrolledItems: pro.sold.length,
    url: page.url(),
    mode: "pro",
  });
  return pro;
}

async function scrapeClassicMonitor(page: Page) {
  const publishedCount = await scrollCatalogUntilStable(page);
  const published = await scrapePublishedCatalogRows(page);
  log("info", "wallapop_monitor_published_scanned", {
    rows: published.length,
    reserved: published.filter((row) => row.reserved).length,
    scrolledItems: publishedCount,
    url: page.url(),
  });

  await gotoVendidosCatalog(page);
  const soldCount = await scrollCatalogUntilStable(page);
  const sold = await scrapeVendidosCatalogRows(page);
  log("info", "wallapop_monitor_sold_scanned", {
    rows: sold.length,
    sold: sold.filter((row) => row.sold).length,
    scrolledItems: soldCount,
    url: page.url(),
  });
  return { published, sold };
}

export async function scrapeCatalogs(
  page: Page,
  accountId: string,
  confirmHrefs?: string[],
) {
  await navigateViaAssign(page, CATALOG_PUBLISHED_URL);
  await dismissWallapopConsent(page);
  if (await leaveIfSessionBlocked(page, accountId)) return null;
  const kind = await wallapopCatalogKind(page);
  if (kind === "pro") return scrapeProMonitor(page, confirmHrefs);
  if (kind !== "classic") {
    log("warn", "wallapop_monitor_catalog_unknown", { url: page.url() });
    return null;
  }
  return scrapeClassicMonitor(page);
}
