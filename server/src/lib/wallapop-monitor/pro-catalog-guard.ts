import type { Page } from "playwright"

import { log } from "../log"
import { ensureTodoElCatalogo, isOnTodoCatalog } from "./pro-catalog-choice"

/** Tab helpers from pro-catalog-pages, passed in to keep the modules apart. */
export type TabDeps = {
  openTab: (page: Page, tab: string) => Promise<void>
  selectedTabLabel: (page: Page) => Promise<string | null>
}

/**
 * 3.11 10:57Z: right after the switch the old tab still looked open, so the tab
 * was not clicked again; the list then reloaded on Activos and was read as Vendidos.
 * After a switch: let the list reload, open the tab, and check which tab is selected.
 */
const AFTER_SWITCH_SETTLE_MS = 3_000
/**
 * VPS 3.11 20:24Z: right after the monitor's own switch the list was still redrawing,
 * no tab was selected and the guard failed the pass. Open the tab again this many times.
 */
const TAB_RETRIES = 2

async function onTab(page: Page, tab: string, deps: TabDeps): Promise<boolean> {
  const label = await deps.selectedTabLabel(page).catch(() => null)
  return Boolean(label?.toLowerCase().startsWith(tab.toLowerCase()))
}

async function reopenTabAfterSwitch(page: Page, tab: string, deps: TabDeps): Promise<void> {
  await page.waitForTimeout(AFTER_SWITCH_SETTLE_MS)
  await deps.openTab(page, tab)
}

/** Waits and opens the tab again while another tab, or none, is selected. Returns the retries used. */
async function reopenUntilOnTab(page: Page, tab: string, deps: TabDeps): Promise<number> {
  let retries = 0
  while (retries < TAB_RETRIES && !(await onTab(page, tab, deps))) {
    retries += 1
    await page.waitForTimeout(AFTER_SWITCH_SETTLE_MS)
    await deps.openTab(page, tab)
  }
  return retries
}

/**
 * Under «Suscripción Multicategoría» each tab hides the other sections (3.11:
 * Vendidos 5 instead of 9, Activos 526 instead of 535). Every Pro tab is read
 * only under «Todo el catálogo»: checked after the tab opens, switched if not.
 */
export async function openTabOnTodo(page: Page, tab: string, deps: TabDeps): Promise<boolean> {
  await deps.openTab(page, tab)
  const before = await isOnTodoCatalog(page)
  let switched = false
  if (!before.ok) {
    switched = await ensureTodoElCatalogo(page)
    await reopenTabAfterSwitch(page, tab, deps)
  }
  const tabRetries = await reopenUntilOnTab(page, tab, deps)
  const todo = before.ok || (await isOnTodoCatalog(page)).ok
  const tabOk = await onTab(page, tab, deps)
  const ok = todo && tabOk
  log(ok ? "info" : "warn", "wallapop_monitor_catalog_guard", {
    tab,
    before: before.label || page.url(),
    switched,
    tabRetries,
    tabOk,
    ok,
  })
  return ok
}

/** The list can reload on Activos while a tab is paged through. */
export async function stillOnTab(page: Page, tab: string, deps: TabDeps): Promise<boolean> {
  if (await onTab(page, tab, deps)) return true
  log("warn", "wallapop_monitor_catalog_guard", { tab, step: "after_read", tabOk: false, ok: false })
  return false
}
