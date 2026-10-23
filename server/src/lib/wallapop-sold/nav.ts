import type { Page } from "playwright"

import {
  dismissWallapopConsent,
  navigateViaAssign,
  registerSoldJobPage,
} from "../wallapop-cdp"
import { log } from "../log"
import {
  clickSellerSoldButton,
  FIND_MARK_AS_SOLD_EVAL,
  isNavigationError,
} from "./click"
import { logConfirmMissing } from "./snapshot"
import { CATALOG_SOLD_URL, WallapopSoldError } from "./types"

/** VPS 2026-10-23: with publish and monitor in the same Chrome the confirm took 15-20 s. */
const CONFIRM_WAIT_MS = 30_000
const CONFIRM_POLL_MS = 500

export async function gotoItemPage(page: Page, itemUrl: string): Promise<void> {
  await navigateViaAssign(page, itemUrl)
  await dismissWallapopConsent(page)
}

async function showsConfirm(page: Page): Promise<boolean> {
  if (page.isClosed()) return false
  try {
    return Boolean(await page.evaluate(FIND_MARK_AS_SOLD_EVAL))
  } catch (error) {
    if (isNavigationError(error)) return false
    throw error
  }
}

async function waitForConfirmTab(
  page: Page,
  popups: Page[],
  timeoutMs: number,
): Promise<Page | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const tab of [...popups, page]) {
      if (await showsConfirm(tab)) return tab
    }
    await page.waitForTimeout(CONFIRM_POLL_MS)
  }
  return null
}

/**
 * Marcar como vendido shows #markAsSoldButton in a new tab (2026-10-08) or in this tab once
 * Wallapop has loaded the next page (every sale on 2026-10-23). Take the tab that shows it first.
 * Only tabs this page opens count: a window another job opens in the same Chrome is not ours.
 */
export async function clickSellerSoldAndWaitTab(
  page: Page,
  timeoutMs = CONFIRM_WAIT_MS,
): Promise<Page> {
  const popups: Page[] = []
  const onPopup = (next: Page) => {
    registerSoldJobPage(next)
    popups.push(next)
  }
  page.on("popup", onPopup)
  const started = Date.now()
  try {
    await clickSellerSoldButton(page)
    const tab = await waitForConfirmTab(page, popups, timeoutMs)
    if (tab) {
      const sameTab = tab === page
      log("info", sameTab ? "wallapop_sold_modal_same_tab" : "wallapop_sold_modal_tab", {
        url: tab.url(),
        waitedMs: Date.now() - started,
      })
      if (!sameTab) await tab.bringToFront().catch(() => {})
      return tab
    }
  } finally {
    page.off("popup", onPopup)
  }
  await logConfirmMissing(page, popups, Date.now() - started)
  throw new WallapopSoldError("confirm", "No se encontró el confirmador #markAsSoldButton.")
}

export async function gotoVendidosCatalog(page: Page): Promise<void> {
  const nav = page.locator('a.nav-link[href="/app/catalog/sold"]').first()
  try {
    if (await nav.isVisible({ timeout: 3_000 })) {
      await nav.click({ timeout: 5_000 })
      await page.waitForTimeout(2_000)
      return
    }
  } catch {
    // fall through to assign
  }
  await navigateViaAssign(page, CATALOG_SOLD_URL, 2_500)
}
