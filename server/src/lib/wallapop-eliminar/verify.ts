import type { Page } from "playwright"

import { wallapopItemPathKey } from "../../../../lib/inventory/wallapop-item-url"
import { log } from "../log"
import {
  dismissWallapopConsent,
  isLoginOr2faUrl,
  navigateViaAssign,
} from "../wallapop-cdp"
import {
  CATALOG_PUBLISHED_URL,
  type PublishedCatalogRow,
} from "../wallapop-monitor/catalog"
import {
  scrapePublishedCatalogRows,
  scrollCatalogUntilStable,
} from "../wallapop-monitor/scrape"
import { findSellerEliminarButton } from "./click"
import { WallapopEliminarError } from "./types"

/** Seller block hydrates after a real reload; cached same-URL assign is not a reload. */
const ITEM_LIVE_WAIT_MS = 10_000
const EN_VENTA_WAIT_MS = 20_000
const POLL_MS = 500

export function publishedRowsContainItem(
  rows: PublishedCatalogRow[],
  itemUrl: string,
): boolean {
  const wanted = wallapopItemPathKey(itemUrl)
  if (!wanted) return false
  return rows.some((row) => wallapopItemPathKey(row.href) === wanted)
}

/** Force a real navigation: location.assign to the same /item/ does not reload. */
export function cacheBustItemUrl(itemUrl: string): string {
  const parsed = new URL(itemUrl)
  parsed.searchParams.set("_crm", String(Date.now()))
  return parsed.href
}

function assertNotLogin(page: Page): void {
  if (isLoginOr2faUrl(page.url())) {
    throw new WallapopEliminarError(
      "verify",
      "Wallapop pidió iniciar sesión durante la comprobación.",
    )
  }
}

async function scrapeEnVenta(page: Page): Promise<PublishedCatalogRow[]> {
  await navigateViaAssign(page, CATALOG_PUBLISHED_URL)
  await dismissWallapopConsent(page)
  assertNotLogin(page)
  await scrollCatalogUntilStable(page)
  return scrapePublishedCatalogRows(page)
}

async function enVentaContainsItem(page: Page, itemUrl: string): Promise<boolean> {
  const deadline = Date.now() + EN_VENTA_WAIT_MS
  let found = true
  let scanned = 0
  while (Date.now() < deadline) {
    const rows = await scrapeEnVenta(page)
    scanned = rows.length
    found = publishedRowsContainItem(rows, itemUrl)
    log("info", "wallapop_eliminar_en_venta_verify", { found, scanned })
    if (!found) return false
    await page.waitForTimeout(POLL_MS)
  }
  log("warn", "wallapop_eliminar_en_venta_still_listed", { scanned })
  return true
}

/** True if seller «Eliminar» hydrates after a cache-busted reload of /item/. */
export async function itemPageStillLive(page: Page, itemUrl: string): Promise<boolean> {
  await navigateViaAssign(page, cacheBustItemUrl(itemUrl))
  await dismissWallapopConsent(page)
  assertNotLogin(page)
  const deadline = Date.now() + ITEM_LIVE_WAIT_MS
  while (Date.now() < deadline) {
    if ((await findSellerEliminarButton(page)) === "found") return true
    await page.waitForTimeout(POLL_MS)
  }
  return false
}

/**
 * Gone = En venta has no such href, then the reloaded /item/ has no seller Eliminar.
 * Catalog first so we leave the item URL (assign to the same href is a no-op).
 */
export async function verifyItemEliminated(
  page: Page,
  itemUrl: string,
): Promise<void> {
  if (await enVentaContainsItem(page, itemUrl)) {
    throw new WallapopEliminarError(
      "verify",
      "El anuncio sigue en «En venta» de Wallapop.",
    )
  }
  const stillLive = await itemPageStillLive(page, itemUrl)
  log(stillLive ? "warn" : "info", "wallapop_eliminar_item_verify", {
    stillLive,
    url: page.url(),
  })
  if (stillLive) {
    throw new WallapopEliminarError(
      "verify",
      "El anuncio sigue visible en Wallapop después de eliminar.",
    )
  }
}
