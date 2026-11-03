import type { Page } from "playwright"

import {
  dismissWallapopConsent,
  navigateViaAssign,
  registerSoldJobPage,
} from "../wallapop-cdp"
import { log } from "../log"
import { readSoldStep } from "./buyer-step"
import { clickSellerSoldButton } from "./click"
import { logConfirmMissing } from "./snapshot"
import { CATALOG_SOLD_URL, WallapopSoldError } from "./types"

/** VPS 2026-10-23: with publish and monitor in the same Chrome the confirm took 15-20 s. */
const CONFIRM_WAIT_MS = 30_000
const CONFIRM_POLL_MS = 500

export async function gotoItemPage(page: Page, itemUrl: string): Promise<void> {
  await navigateViaAssign(page, itemUrl)
  await dismissWallapopConsent(page)
}

/** After "Lo vendí fuera de Wallapop" the sold modal may close without the old confirm. */
const OUTSIDE_CLOSED_MS = 3_000

/** The tab with the sale and whether it still shows #markAsSoldButton to click. */
export type SoldConfirmTab = { tab: Page; confirm: boolean }

type Waiting = { clicked: Map<Page, number>; buyers: boolean }

/** One look at a tab. Clicks "Lo vendí fuera de Wallapop" once per tab, never a buyer. */
async function lookAtTab(tab: Page, waiting: Waiting): Promise<SoldConfirmTab | null> {
  const clickedAt = waiting.clicked.get(tab)
  const view = await readSoldStep(tab, clickedAt === undefined)
  if (view === "confirm") return { tab, confirm: true }
  if (view === "buyers") waiting.buyers = true
  if (view === "outside" && clickedAt === undefined) {
    waiting.clicked.set(tab, Date.now())
    log("info", "wallapop_sold_outside_click", { url: tab.url() })
    return null
  }
  if (view === "none" && clickedAt !== undefined && Date.now() - clickedAt >= OUTSIDE_CLOSED_MS) {
    log("info", "wallapop_sold_outside_no_confirm", { url: tab.url() })
    return { tab, confirm: false }
  }
  return null
}

async function waitForConfirmTab(
  page: Page,
  popups: Page[],
  timeoutMs: number,
  waiting: Waiting,
): Promise<SoldConfirmTab | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const tab of [...popups, page]) {
      const found = await lookAtTab(tab, waiting)
      if (found) return found
    }
    await page.waitForTimeout(CONFIRM_POLL_MS)
  }
  return null
}

function confirmMissingMessage(waiting: Waiting): string {
  if (waiting.clicked.size > 0) {
    return "Tras «Lo vendí fuera de Wallapop» no apareció el confirmador #markAsSoldButton."
  }
  if (waiting.buyers) {
    return "Wallapop pide elegir comprador y no se encontró «Lo vendí fuera de Wallapop»."
  }
  return "No se encontró el confirmador #markAsSoldButton."
}

/**
 * Marcar como vendido shows #markAsSoldButton in a new tab (2026-10-08) or in this tab once
 * Wallapop has loaded the next page (every sale on 2026-10-23). Take the tab that shows it first.
 * Only tabs this page opens count: a window another job opens in the same Chrome is not ours.
 * An item with chats first asks "Selecciona a quién lo vendiste" (2026-11-03): the sibling was
 * sold elsewhere, so the answer is "Lo vendí fuera de Wallapop", then the confirm if it shows.
 */
export async function clickSellerSoldAndWaitTab(
  page: Page,
  timeoutMs = CONFIRM_WAIT_MS,
): Promise<SoldConfirmTab> {
  const popups: Page[] = []
  const onPopup = (next: Page) => {
    registerSoldJobPage(next)
    popups.push(next)
  }
  page.on("popup", onPopup)
  const started = Date.now()
  const waiting: Waiting = { clicked: new Map(), buyers: false }
  try {
    await clickSellerSoldButton(page)
    const found = await waitForConfirmTab(page, popups, timeoutMs, waiting)
    if (found) {
      const sameTab = found.tab === page
      log("info", sameTab ? "wallapop_sold_modal_same_tab" : "wallapop_sold_modal_tab", {
        url: found.tab.url(),
        waitedMs: Date.now() - started,
        ...(waiting.clicked.size > 0 ? { outside: true } : {}),
      })
      if (!sameTab) await found.tab.bringToFront().catch(() => {})
      return found
    }
  } finally {
    page.off("popup", onPopup)
  }
  await logConfirmMissing(page, popups, Date.now() - started)
  throw new WallapopSoldError("confirm", confirmMissingMessage(waiting))
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
