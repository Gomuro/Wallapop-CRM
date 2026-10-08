import type { BrowserContext, Page } from "playwright"

import {
  dismissWallapopConsent,
  navigateViaAssign,
  registerSoldJobPage,
} from "../wallapop-cdp"
import { log } from "../log"
import { clickSellerSoldButton } from "./click"
import { CATALOG_SOLD_URL } from "./types"

export async function gotoItemPage(page: Page, itemUrl: string): Promise<void> {
  await navigateViaAssign(page, itemUrl)
  await dismissWallapopConsent(page)
}

export async function clickSellerSoldAndWaitTab(
  page: Page,
): Promise<Page> {
  const context: BrowserContext = page.context()
  const popup = context
    .waitForEvent("page", { timeout: 15_000 })
    .then((next) => {
      registerSoldJobPage(next)
      return next
    })
  await clickSellerSoldButton(page)
  try {
    const next = await popup
    await next.waitForLoadState("domcontentloaded").catch(() => {})
    await next.bringToFront().catch(() => {})
    log("info", "wallapop_sold_modal_tab", { url: next.url() })
    return next
  } catch {
    log("info", "wallapop_sold_modal_same_tab")
    return page
  }
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
