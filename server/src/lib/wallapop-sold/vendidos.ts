import type { Page } from "playwright"

import { dismissWallapopConsent, navigateViaAssign } from "../wallapop-cdp"
import { log } from "../log"
import { CATALOG_PUBLISHED_URL } from "../wallapop-monitor/catalog"
import { wallapopCatalogKind } from "../wallapop-monitor/pro-catalog"
import { readProVendidos } from "../wallapop-monitor/pro-vendidos"
import { gotoVendidosCatalog } from "./nav"
import { saveSoldSnapshotOutsideTests } from "./snapshot"
import {
  soldCatalogHrefMatches,
  vendidosFirstRowMatches,
  vendidosHrefMatches,
} from "./verify"

/** The tab after the confirm is the catalog: PRO shows the Activos tab, classic the cards. */
const KIND_TIMING = { budgetMs: 8_000, pollMs: 500 }

/**
 * PRO (VPS 2026-11-03): /app/catalog/sold has no `tsl-catalog-item`, so every check read
 * 0 rows. Read Vendidos the way the monitor does and accept the item anywhere in it.
 */
async function verifyProVendidos(page: Page, itemUrl: string): Promise<boolean> {
  await navigateViaAssign(page, CATALOG_PUBLISHED_URL)
  await dismissWallapopConsent(page)
  const read = await readProVendidos(page)
  const rows = read?.rows ?? []
  const ok = read != null && soldCatalogHrefMatches(rows, itemUrl)
  log(ok ? "info" : "warn", "wallapop_sold_vendidos_verify", {
    ok,
    kind: "pro",
    anywhere: true,
    url: page.url(),
    tab: "Vendidos",
    catalog: read?.catalog ?? null,
    read: read != null,
    scanned: rows.length,
  })
  if (!ok) await saveSoldSnapshotOutsideTests(page, "vendidos-last")
  return ok
}

/** After the confirm: is the item in Vendidos? Classic accounts keep the old check. */
export async function verifySoldInVendidos(
  page: Page,
  itemUrl: string,
  matchAnywhere: boolean,
): Promise<boolean> {
  const kind = await wallapopCatalogKind(page, KIND_TIMING)
  if (kind === "pro") return verifyProVendidos(page, itemUrl)
  await gotoVendidosCatalog(page)
  const context = { kind }
  return matchAnywhere
    ? vendidosHrefMatches(page, itemUrl, context)
    : vendidosFirstRowMatches(page, itemUrl, context)
}
