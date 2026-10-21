import type { Page } from "playwright";

import { assignChromePlaces } from "../account-chrome";
import { getPrisma } from "../db";
import { log, serializeError } from "../log";
import {
  pullQueuedListingsForSoldProducts,
  revertRelistedSale,
  revertRemovedSale,
} from "../product-sold";
import { scheduleOpenSiblingAdsForSoldProducts } from "../sibling-eliminar";
import {
  scheduleOpenSiblingAdsForReservedProducts,
  scheduleSiblingUnreserve,
} from "../sibling-reserve";
import {
  closeWorkerSlotPages,
  ensureWorkerWindow,
  isBrowserBusyError,
  quitChromeIfNoWorkerSlots,
  runWithBrowserBusy,
} from "../wallapop-cdp";
import { peekWallapopSession } from "../wallapop-session";
import { applyMonitorPlan } from "./apply";
import {
  planLinkedSales,
  planMonitorUpdates,
  type LinkedSaleListing,
  type MonitorCrmListing,
} from "./diff";
import { confirmMissingItemPages } from "./item-probe";
import { scrapeCatalogs } from "./tick-scrape";

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

async function loadLinkedSoldListings(accountId: string): Promise<LinkedSaleListing[]> {
  const prisma = getPrisma();
  if (!prisma) return [];
  return prisma.productListing.findMany({
    where: {
      accountId,
      status: "DEACTIVATED",
      externalUrl: { not: null },
      product: { status: "SOLD", soldAccountId: accountId },
    },
    select: { productId: true, externalUrl: true },
  });
}

function planNeedsConfirm(
  plan: { toMissing: string[] },
  linked: { removedProductIds: string[]; relistedProductIds: string[] },
): boolean {
  return (
    plan.toMissing.length > 0 ||
    linked.removedProductIds.length > 0 ||
    linked.relistedProductIds.length > 0
  );
}

async function confirmCatalogRead(input: {
  page: Page;
  accountId: string;
  listings: MonitorCrmListing[];
  catalogs: NonNullable<Awaited<ReturnType<typeof scrapeCatalogs>>>;
  linkedSold: LinkedSaleListing[];
}) {
  const { page, accountId, listings, catalogs, linkedSold } = input;
  let plan = planMonitorUpdates(catalogs.published, catalogs.sold, listings);
  let linked = planLinkedSales(catalogs.published, catalogs.sold, linkedSold);
  if (!planNeedsConfirm(plan, linked)) return { plan, linked };
  const confirmHrefs = listings
    .filter(
      (listing) =>
        plan.toMissing.includes(listing.id) && listing.externalUrl,
    )
    .map((listing) => listing.externalUrl as string);
  log("info", "wallapop_monitor_reread_activos", {
    accountId,
    missing: confirmHrefs.length,
    removedSales: linked.removedProductIds.length,
    relistedSales: linked.relistedProductIds.length,
  });
  const reread = await scrapeCatalogs(page, accountId, confirmHrefs);
  if (!reread) return null;
  plan = planMonitorUpdates(reread.published, reread.sold, listings);
  linked = planLinkedSales(reread.published, reread.sold, linkedSold);
  return { plan, linked };
}

async function runMonitorAfterAttach(
  accountId: string,
  port: number,
): Promise<string[]> {
  const page = await ensureWorkerWindow("monitor", port);
  try {
    const listings = await loadLiveListings(accountId);
    const linkedSold = await loadLinkedSoldListings(accountId);
    log("info", "wallapop_monitor_listings_snapshot", {
      accountId,
      count: listings.length,
    });
    const catalogs = await scrapeCatalogs(page, accountId);
    if (!catalogs) return [];
    const confirmed = await confirmCatalogRead({
      page,
      accountId,
      listings,
      catalogs,
      linkedSold,
    });
    if (!confirmed) return [];
    log("info", "wallapop_monitor_item_probe_queue", {
      accountId,
      candidates: confirmed.plan.toMissing.length,
    });
    const toMissing = await confirmMissingItemPages(
      page,
      listings,
      confirmed.plan.toMissing,
      accountId,
    );
    const plan = { ...confirmed.plan, toMissing };
    log("info", "wallapop_monitor_plan", {
      toReserved: plan.toReserved.length,
      toActive: plan.toActive.length,
      toSold: plan.toSoldProductIds.length,
      toMissing: plan.toMissing.length,
      orphanPublished: plan.orphanPublished.length,
      orphanSold: plan.orphanSold.length,
      removedSales: confirmed.linked.removedProductIds.length,
      relistedSales: confirmed.linked.relistedProductIds.length,
    });
    await applyMonitorPlan(plan, accountId);
    await releaseCancelledSales(accountId, confirmed.linked);
    return confirmed.linked.stillSoldProductIds;
  } finally {
    await closeWorkerSlotPages("monitor", port);
  }
}

async function releaseCancelledSales(
  accountId: string,
  linked: {
    removedProductIds: string[];
    relistedProductIds: string[];
  },
): Promise<void> {
  const prisma = getPrisma();
  if (!prisma) return;
  for (const productId of linked.removedProductIds) {
    const reverted = await revertRemovedSale(prisma, productId);
    if (!reverted) continue;
    log("info", "wallapop_monitor_sale_removed", { productId, accountId });
    void scheduleSiblingUnreserve(productId, accountId);
  }
  for (const productId of linked.relistedProductIds) {
    const reverted = await revertRelistedSale(prisma, productId);
    if (!reverted) continue;
    log("info", "wallapop_monitor_sale_relisted", { productId, accountId });
    void scheduleSiblingUnreserve(productId, accountId);
  }
}

async function monitorActiveAccount(
  account: { id: string },
  places: ReturnType<typeof assignChromePlaces>,
  stillSold: Set<string>,
): Promise<void> {
  const port = places.get(account.id)?.port;
  if (port == null) return;
  try {
    const confirmed = await runWithBrowserBusy(
      "monitor",
      () => runMonitorAfterAttach(account.id, port),
      port,
    );
    for (const productId of confirmed) stillSold.add(productId);
  } catch (error) {
    if (isBrowserBusyError(error)) {
      log("info", "wallapop_monitor_skip_busy", { busy: error.busyWith, port });
      return;
    }
    log("warn", "wallapop_monitor_tick_failed", {
      port,
      err: serializeError(error),
    });
  } finally {
    await quitChromeIfNoWorkerSlots(port);
  }
}

export async function runWallapopMonitorTick(): Promise<void> {
  void pullQueuedListingsForSoldProducts();
  void scheduleOpenSiblingAdsForReservedProducts();
  const prisma = getPrisma();
  if (!prisma) return;
  const accounts = await prisma.account.findMany({
    select: { id: true, chromeSlot: true },
  });
  const places = assignChromePlaces(accounts);
  const active = accounts.filter(
    (account) => peekWallapopSession(account.id).status === "ACTIVE",
  );
  const stillSold = new Set<string>();
  if (active.length === 0) {
    log("info", "wallapop_monitor_skip_session", { status: "DISCONNECTED" });
    await quitChromeIfNoWorkerSlots();
    return;
  }
  for (const account of active) {
    await monitorActiveAccount(account, places, stillSold);
  }
  void scheduleOpenSiblingAdsForSoldProducts(stillSold);
}
