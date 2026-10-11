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

/** Seller block may hydrate late; wait this long before calling the item gone. */
const ITEM_LIVE_WAIT_MS = 8_000
const POLL_MS = 400

export function publishedRowsContainItem(
  rows: PublishedCatalogRow[],
  itemUrl: string,
): boolean {
  const wanted = wallapopItemPathKey(itemUrl)
  if (!wanted) return false
  return rows.some((row) => wallapopItemPathKey(row.href) === wanted)
}

function assertNotLogin(page: Page): void {
  if (isLoginOr2faUrl(page.url())) {
    throw new WallapopEliminarError(
      "verify",
      "Wallapop pidió iniciar sesión durante la comprobación.",
    )
  }
}

/** True while our seller «Eliminar» still renders on the old /item/ page. */
async function itemPageStillLive(page: Page, itemUrl: string): Promise<boolean> {
  await navigateViaAssign(page, itemUrl)
  await dismissWallapopConsent(page)
  assertNotLogin(page)
  const deadline = Date.now() + ITEM_LIVE_WAIT_MS
  while (Date.now() < deadline) {
    if ((await findSellerEliminarButton(page)) === "found") return true
    await page.waitForTimeout(POLL_MS)
  }
  return false
}

async function enVentaContainsItem(page: Page, itemUrl: string): Promise<boolean> {
  await navigateViaAssign(page, CATALOG_PUBLISHED_URL)
  await dismissWallapopConsent(page)
  assertNotLogin(page)
  await scrollCatalogUntilStable(page)
  const rows = await scrapePublishedCatalogRows(page)
  const found = publishedRowsContainItem(rows, itemUrl)
  log(found ? "warn" : "info", "wallapop_eliminar_en_venta_verify", {
    found,
    scanned: rows.length,
  })
  return found
}

/** Gone = old /item/ has no seller Eliminar and En venta has no such href. */
export async function verifyItemEliminated(
  page: Page,
  itemUrl: string,
): Promise<void> {
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
  if (await enVentaContainsItem(page, itemUrl)) {
    throw new WallapopEliminarError(
      "verify",
      "El anuncio sigue en «En venta» de Wallapop.",
    )
  }
}
