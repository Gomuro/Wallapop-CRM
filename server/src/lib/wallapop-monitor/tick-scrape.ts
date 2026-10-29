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
import type { SoldCatalogRow } from "./diff";
import {
  ensureTodoElCatalogo,
  scrapeProSold,
  wallapopCatalogKind,
} from "./pro-catalog";
import { readPublishedFromProfile } from "./published-from-profile";
import {
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

async function scrapeProSoldTab(page: Page): Promise<SoldCatalogRow[] | null> {
  const onFullCatalog = await ensureTodoElCatalogo(page);
  if (!onFullCatalog) {
    log("warn", "wallapop_monitor_catalog_not_full", { url: page.url() });
    return null;
  }
  return scrapeProSold(page);
}

async function scrapeClassicSold(page: Page): Promise<SoldCatalogRow[]> {
  await gotoVendidosCatalog(page);
  await scrollCatalogUntilStable(page);
  return scrapeVendidosCatalogRows(page);
}

/** Vendidos in Chrome, the one thing the public profile cannot tell: which ads were sold. */
async function scrapeSold(page: Page, accountId: string): Promise<SoldCatalogRow[] | null> {
  await navigateViaAssign(page, CATALOG_PUBLISHED_URL);
  await dismissWallapopConsent(page);
  if (await leaveIfSessionBlocked(page, accountId)) return null;
  const kind = await wallapopCatalogKind(page);
  if (kind !== "pro" && kind !== "classic") {
    log("warn", "wallapop_monitor_catalog_unknown", { url: page.url() });
    return null;
  }
  const sold = kind === "pro" ? await scrapeProSoldTab(page) : await scrapeClassicSold(page);
  if (!sold) return null;
  log("info", "wallapop_monitor_sold_scanned", {
    rows: sold.length,
    sold: sold.filter((row) => row.sold).length,
    url: page.url(),
    mode: kind,
  });
  return sold;
}

/**
 * For sale and reserved from the public profile, sold from Chrome. Null when either could
 * not be read: the pass is incomplete and the caller applies nothing.
 */
export async function scrapeCatalogs(
  page: Page,
  accountId: string,
  liveInCrm: number,
) {
  const published = await readPublishedFromProfile(accountId, liveInCrm);
  if (!published) {
    log("warn", "wallapop_monitor_profile_unavailable", { accountId });
    return null;
  }
  log("info", "wallapop_monitor_published_scanned", {
    rows: published.length,
    reserved: published.filter((row) => row.reserved).length,
    mode: "profile_api",
  });
  const sold = await scrapeSold(page, accountId);
  if (!sold) return null;
  return { published, sold };
}
