import type { Page } from "playwright";

import { assignChromePlaces } from "../account-chrome";
import { getPrisma } from "../db";
import { log, serializeError } from "../log";
import { pullQueuedListingsForSoldProducts } from "../product-sold";
import { scheduleOpenSiblingAdsForSoldProducts } from "../sibling-eliminar";
import {
  closeWorkerSlotPages,
  dismissWallapopConsent,
  ensureWorkerWindow,
  isBrowserBusyError,
  isLoginOr2faUrl,
  isWallapopLoggedOutUrl,
  navigateViaAssign,
  quitChromeIfNoWorkerSlots,
  runWithBrowserBusy,
} from "../wallapop-cdp";
import { gotoVendidosCatalog } from "../wallapop-sold/nav";
import {
  markWallapopSessionLoggedOut,
  peekWallapopSession,
} from "../wallapop-session";
import { applyMonitorPlan } from "./apply";
import { CATALOG_PUBLISHED_URL } from "./catalog";
import { planMonitorUpdates, type MonitorCrmListing } from "./diff";
import {
  ensureTodoElCatalogo,
  scrapeProCatalogs,
  wallapopCatalogKind,
} from "./pro-catalog";
import {
  scrapePublishedCatalogRows,
  scrapeVendidosCatalogRows,
  scrollCatalogUntilStable,
} from "./scrape";

async function loadLiveListings(accountId: string): Promise<MonitorCrmListing[]> {
  const prisma = getPrisma();
  if (!prisma) return [];
  const listings = await prisma.productListing.findMany({
    where: {
      accountId,
      status: { in: ["ACTIVE", "RESERVED"] },
    },
    select: {
      id: true,
      productId: true,
      status: true,
      externalUrl: true,
    },
  });
  return listings;
}

async function scrapeCatalogs(page: Page, accountId: string, confirmHrefs?: string[]) {
  await navigateViaAssign(page, CATALOG_PUBLISHED_URL);
  await dismissWallapopConsent(page);
  if (isWallapopLoggedOutUrl(page.url())) {
    log("info", "wallapop_monitor_logged_out", { url: page.url(), accountId });
    await markWallapopSessionLoggedOut(accountId);
    return null;
  }
  if (isLoginOr2faUrl(page.url())) {
    log("info", "wallapop_monitor_skip_login", { url: page.url() });
    return null;
  }
  const kind = await wallapopCatalogKind(page);
  if (kind === "pro") {
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
  if (kind !== "classic") {
    log("warn", "wallapop_monitor_catalog_unknown", { url: page.url() });
    return null;
  }
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

async function runMonitorAfterAttach(accountId: string, port: number): Promise<void> {
  const page = await ensureWorkerWindow("monitor", port);
  try {
    const listings = await loadLiveListings(accountId);
    log("info", "wallapop_monitor_listings_snapshot", {
      accountId,
      count: listings.length,
    });
    let catalogs = await scrapeCatalogs(page, accountId);
    if (!catalogs) return;
    let plan = planMonitorUpdates(catalogs.published, catalogs.sold, listings);
    if (plan.toDeactivated.length > 0) {
      const confirmHrefs = listings
        .filter(
          (listing) =>
            plan.toDeactivated.includes(listing.id) && listing.externalUrl,
        )
        .map((listing) => listing.externalUrl as string);
      log("info", "wallapop_monitor_reread_activos", {
        accountId,
        missing: confirmHrefs.length,
      });
      catalogs = await scrapeCatalogs(page, accountId, confirmHrefs);
      if (!catalogs) return;
      plan = planMonitorUpdates(catalogs.published, catalogs.sold, listings);
    }
    log("info", "wallapop_monitor_plan", {
      toReserved: plan.toReserved.length,
      toActive: plan.toActive.length,
      toSold: plan.toSoldProductIds.length,
      toDeactivated: plan.toDeactivated.length,
      orphanPublished: plan.orphanPublished.length,
      orphanSold: plan.orphanSold.length,
    });
    await applyMonitorPlan(plan, accountId);
  } finally {
    await closeWorkerSlotPages("monitor", port);
  }
}

export async function runWallapopMonitorTick(): Promise<void> {
  void pullQueuedListingsForSoldProducts();
  void scheduleOpenSiblingAdsForSoldProducts();
  const prisma = getPrisma();
  if (!prisma) return;
  const accounts = await prisma.account.findMany({
    select: { id: true, chromeSlot: true },
  });
  const places = assignChromePlaces(accounts);
  const active = accounts.filter(
    (account) => peekWallapopSession(account.id).status === "ACTIVE",
  );
  if (active.length === 0) {
    log("info", "wallapop_monitor_skip_session", { status: "DISCONNECTED" });
    await quitChromeIfNoWorkerSlots();
    return;
  }
  for (const account of active) {
    const port = places.get(account.id)?.port;
    if (port == null) continue;
    try {
      await runWithBrowserBusy(
        "monitor",
        () => runMonitorAfterAttach(account.id, port),
        port,
      );
    } catch (error) {
      if (isBrowserBusyError(error)) {
        log("info", "wallapop_monitor_skip_busy", { busy: error.busyWith, port });
        continue;
      }
      log("warn", "wallapop_monitor_tick_failed", {
        port,
        err: serializeError(error),
      });
    } finally {
      await quitChromeIfNoWorkerSlots(port);
    }
  }
}
