import type { Page } from "playwright"

import { log } from "../log"
import { scrapeSoldCatalogRows } from "../wallapop-sold/verify"
import {
  PUBLISHED_CATALOG_ROWS_EVAL,
  type PublishedCatalogRow,
} from "./catalog"
import type { SoldCatalogRow } from "./diff"

const MAX_SCROLLS = 40
const SCROLL_SETTLE_MS = 500
const FIRST_ITEM_MS = 20_000

export async function waitForCatalogItems(page: Page): Promise<number> {
  await page
    .locator("tsl-catalog-item")
    .first()
    .waitFor({ state: "attached", timeout: FIRST_ITEM_MS })
    .catch(() => {})
  return (await page.evaluate(
    `document.querySelectorAll("tsl-catalog-item").length`,
  )) as number
}

export async function scrollCatalogUntilStable(page: Page): Promise<number> {
  await waitForCatalogItems(page)
  let prev = -1
  let stable = 0
  let count = 0
  for (let i = 0; i < MAX_SCROLLS; i += 1) {
    count = (await page.evaluate(
      `document.querySelectorAll("tsl-catalog-item").length`,
    )) as number
    if (count === prev) {
      stable += 1
      if (stable >= 2) break
    } else {
      stable = 0
    }
    prev = count
    await page.evaluate(`window.scrollTo(0, document.body.scrollHeight)`)
    await page.waitForTimeout(SCROLL_SETTLE_MS)
  }
  return count
}

export async function scrapePublishedCatalogRows(
  page: Page,
): Promise<PublishedCatalogRow[]> {
  try {
    return (
      ((await page.evaluate(
        PUBLISHED_CATALOG_ROWS_EVAL,
      )) as PublishedCatalogRow[]) ?? []
    )
  } catch (error) {
    log("warn", "wallapop_monitor_published_scrape_failed", {
      message: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

export async function scrapeVendidosCatalogRows(
  page: Page,
): Promise<SoldCatalogRow[]> {
  return scrapeSoldCatalogRows(page)
}
