import type { Page } from "playwright"

import { log } from "../log"
import { CLICK_NEXT_EVAL, CLICK_PREV_EVAL } from "./pro-catalog-eval"

/** What the reader needs from one table page. */
export type StaleShot = { rows: { href: string }[]; pager: string }

export type StaleDeps = {
  readShot: (page: Page) => Promise<StaleShot>
  /** Waits until the pager moved past `previousPager` and the first row is not `previousHref`. */
  waitForPage: (page: Page, expected: { previousPager?: string; previousHref?: string }) => Promise<void>
}

/** Re-request the page this many times, then let the pass end incomplete. */
const STALE_RETRIES = 2
const PREV_SETTLE_MS = 2_000
const NEXT_SETTLE_MS = 3_000

/**
 * After Next the pager already shows the new page but the rows are still the old ones.
 * Wallapop then counts "to" from the old rows: "521-560 de 536" with 40 rows on the last
 * page (VPS snapshot 2026-10-29: "481-520 de 510", 40 rows, Next disabled).
 */
export function isStalePage(now: StaleShot, before: StaleShot): boolean {
  const first = now.rows[0]?.href
  return Boolean(first) && first === before.rows[0]?.href && now.pager !== before.pager
}

/**
 * VPS 2026-11-03: 15 incomplete Activos passes. Either the last page was never read
 * (520 of 536) or the page before it was skipped (488 of 528 = 12 pages + the last 8).
 * A page whose rows did not change is asked for again with Prev and Next.
 */
export async function reloadIfStale(page: Page, before: StaleShot, deps: StaleDeps): Promise<boolean> {
  for (let attempt = 1; attempt <= STALE_RETRIES; attempt += 1) {
    const now = await deps.readShot(page)
    if (!isStalePage(now, before)) return true
    log("warn", "wallapop_monitor_pro_stale_page", { pager: now.pager, attempt })
    if (!(await page.evaluate(CLICK_PREV_EVAL))) return false
    await page.waitForTimeout(PREV_SETTLE_MS)
    const back = await deps.readShot(page)
    if (!(await page.evaluate(CLICK_NEXT_EVAL))) return false
    await deps.waitForPage(page, { previousPager: back.pager, previousHref: back.rows[0]?.href })
    await page.waitForTimeout(NEXT_SETTLE_MS)
  }
  return !isStalePage(await deps.readShot(page), before)
}
