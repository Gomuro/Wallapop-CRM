import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import type { Page } from "playwright"

import { log } from "../log"

/**
 * Diagnostics for incomplete Pro catalog passes (2026-10-29: 440-480 of ~511 collected
 * with no stale page). One log line per Activos page, and the last page's table on an
 * incomplete pass, to see where ads go missing.
 */
const DEFAULT_DIR = path.resolve(process.cwd(), "server", "logs", "monitor-debug")
/** Files activos-incomplete-0..4: the last five incomplete passes, oldest overwritten. */
const KEEP_SNAPSHOTS = 5
const HTML_MAX_CHARS = 300_000

let snapshotDir = DEFAULT_DIR
let snapshotCount = 0

/** Tests write snapshots to a temp folder; null restores the VPS folder. */
export function setProSnapshotDirForTests(dir: string | null): void {
  snapshotDir = dir ?? DEFAULT_DIR
  snapshotCount = 0
}

export function logProPage(
  tab: string,
  pageNumber: number,
  shot: { pager: string; rows: Array<{ href: string }> },
  newRows: number,
): void {
  if (tab !== "Activos") return
  log("info", "wallapop_monitor_pro_page", {
    tab,
    page: pageNumber,
    pager: shot.pager,
    rows: shot.rows.length,
    newRows,
    firstHref: shot.rows[0]?.href ?? null,
    lastHref: shot.rows[shot.rows.length - 1]?.href ?? null,
  })
}

/** Only the catalog table and the pager: no site header, account name, scripts or cookies. */
const CATALOG_TABLE_HTML_EVAL = `(() => {
  const row = document.querySelector('tr[id^="CatalogItem_"]')
  const table = row ? row.closest("table") : null
  const pager = document.querySelector("tsl-pagination-actions .PaginationActions__info")
  return {
    pager: pager ? String(pager.textContent || "").replace(/\\s+/g, " ").trim() : "",
    rows: document.querySelectorAll('tr[id^="CatalogItem_"]').length,
    html: table ? table.outerHTML : "",
  }
})()`

/** Saves the page the incomplete pass ended on. Never throws. */
export async function saveIncompleteActivos(page: Page, info: { collected: number; total: number | null }): Promise<string | null> {
  try {
    const shot = (await page.evaluate(CATALOG_TABLE_HTML_EVAL)) as { pager: string; rows: number; html: string }
    const file = path.join(snapshotDir, `activos-incomplete-${snapshotCount % KEEP_SNAPSHOTS}.html`)
    snapshotCount += 1
    const header = `<!-- ${new Date().toISOString()} collected ${info.collected} of ${info.total ?? "?"}; pager "${shot.pager}"; rows on page ${shot.rows} -->\n`
    const html = shot.html.replace(/<script\b[\s\S]*?<\/script>/gi, "")
    await mkdir(snapshotDir, { recursive: true })
    await writeFile(file, header + html.slice(0, HTML_MAX_CHARS), "utf8")
    return file
  } catch (error) {
    log("warn", "wallapop_monitor_snapshot_failed", { message: error instanceof Error ? error.message : String(error) })
    return null
  }
}
