import type { Page } from "playwright"

import { log } from "../log"
import { ensureTodoElCatalogo, isOnTodoCatalog } from "./pro-catalog-choice"
import { closeProCatalogModal } from "./pro-catalog-modal"
import { readAllPages } from "./pro-catalog-pages"

export type ProVendidosRead = {
  rows: { href: string; sold: boolean }[]
  /** The «Catálogo seleccionado» label when the tab was read. */
  catalog: string
}

/**
 * PRO Vendidos the way the monitor reads it on /app/catalog/management:
 * «Todo el catálogo», the Vendidos tab, every pager page. Null when the
 * catalog or the tab could not be held (the guard logs why).
 */
export async function readProVendidos(page: Page): Promise<ProVendidosRead | null> {
  await closeProCatalogModal(page, "catalog")
  if (!(await ensureTodoElCatalogo(page))) {
    log("warn", "wallapop_monitor_catalog_not_full", { url: page.url(), for: "vendidos" })
    return null
  }
  const read = await readAllPages(page, "Vendidos")
  if (!read) return null
  const { label } = await isOnTodoCatalog(page)
  return {
    rows: read.rows.map((row) => ({ href: row.href, sold: row.sold })),
    catalog: label,
  }
}
