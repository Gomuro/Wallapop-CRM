import type { Page } from "playwright"

import { findDefaultAccountId } from "../default-account"
import { getPrisma } from "../db"
import { log, serializeError } from "../log"
import {
  closeWorkerSlotPages,
  dismissWallapopConsent,
  ensureWorkerWindow,
  isBrowserBusyError,
  isLoginOr2faUrl,
  navigateViaAssign,
  runWithBrowserBusy,
} from "../wallapop-cdp"
import { gotoVendidosCatalog } from "../wallapop-sold/nav"
import { getWallapopSession } from "../wallapop-session"
import { applyMonitorPlan } from "./apply"
import { CATALOG_PUBLISHED_URL } from "./catalog"
import { planMonitorUpdates, type MonitorCrmListing } from "./diff"
import {
  scrapePublishedCatalogRows,
  scrapeVendidosCatalogRows,
  scrollCatalogUntilStable,
} from "./scrape"

async function loadLiveListings(): Promise<MonitorCrmListing[]> {
  const prisma = getPrisma()
  if (!prisma) return []
  const accountId = await findDefaultAccountId(prisma)
  if (!accountId) return []
  return prisma.productListing.findMany({
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
  })
}

async function scrapeCatalogs(page: Page) {
  await navigateViaAssign(page, CATALOG_PUBLISHED_URL)
  await dismissWallapopConsent(page)
  if (isLoginOr2faUrl(page.url())) {
    log("info", "wallapop_monitor_skip_login", { url: page.url() })
    return null
  }
  const publishedCount = await scrollCatalogUntilStable(page)
  const published = await scrapePublishedCatalogRows(page)
  log("info", "wallapop_monitor_published_scanned", {
    rows: published.length,
    reserved: published.filter((row) => row.reserved).length,
    scrolledItems: publishedCount,
  })

  await gotoVendidosCatalog(page)
  const soldCount = await scrollCatalogUntilStable(page)
  const sold = await scrapeVendidosCatalogRows(page)
  log("info", "wallapop_monitor_sold_scanned", {
    rows: sold.length,
    sold: sold.filter((row) => row.sold).length,
    scrolledItems: soldCount,
  })
  return { published, sold }
}

async function runMonitorAfterAttach(): Promise<void> {
  const page = await ensureWorkerWindow("monitor")
  try {
    const catalogs = await scrapeCatalogs(page)
    if (!catalogs) return
    const listings = await loadLiveListings()
    const plan = planMonitorUpdates(
      catalogs.published,
      catalogs.sold,
      listings,
    )
    log("info", "wallapop_monitor_plan", {
      toReserved: plan.toReserved.length,
      toActive: plan.toActive.length,
      toSold: plan.toSoldProductIds.length,
      orphanPublished: plan.orphanPublished.length,
      orphanSold: plan.orphanSold.length,
    })
    await applyMonitorPlan(plan)
  } finally {
    await closeWorkerSlotPages("monitor")
  }
}

export async function runWallapopMonitorTick(): Promise<void> {
  const session = getWallapopSession()
  if (session.status !== "ACTIVE") {
    log("info", "wallapop_monitor_skip_session", { status: session.status })
    return
  }
  try {
    await runWithBrowserBusy("monitor", () => runMonitorAfterAttach())
  } catch (error) {
    if (isBrowserBusyError(error)) {
      log("info", "wallapop_monitor_skip_busy", { busy: error.busyWith })
      return
    }
    log("warn", "wallapop_monitor_tick_failed", {
      err: serializeError(error),
    })
  }
}
