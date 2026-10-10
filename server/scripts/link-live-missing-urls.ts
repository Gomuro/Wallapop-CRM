/**
 * En Wallapop (ACTIVE/RESERVED) without a public /item/ URL.
 * Scrapes En venta + Vendidos, opens orphan cards, Groq-matches to those SKUs.
 * Chrome CDP + GROQ_API_KEY. Does not quit Chrome.
 *
 *   npx tsx server/scripts/link-live-missing-urls.ts
 *   npx tsx server/scripts/link-live-missing-urls.ts --apply
 */
import "../load-env"

import { chromium } from "playwright"

import { wallapopItemSlugHrefOrNull } from "../../lib/inventory/wallapop-item-url"

import { findDefaultAccountId } from "../src/lib/default-account"
import { getPrisma } from "../src/lib/db"
import {
  CATALOG_PUBLISHED_URL,
  CATALOG_SOLD_URL,
} from "../src/lib/wallapop-monitor/catalog"
import {
  ITEM_PAGE_FACTS_EVAL,
  planItemPageUrlLinks,
  type ItemPageCrmListing,
  type ItemPageFacts,
} from "../src/lib/wallapop-monitor/link-by-item-page"
import {
  CATALOG_TITLE_CARDS_EVAL,
  type CatalogTitleCard,
} from "../src/lib/wallapop-monitor/link-by-title"
import { scrollCatalogUntilStable } from "../src/lib/wallapop-monitor/scrape"

const CDP = process.env.WALLAPOP_CDP_URL?.trim() || "http://127.0.0.1:9222"

function isLive(status: string | null | undefined): boolean {
  return status === "ACTIVE" || status === "RESERVED"
}

async function scrapeCards(
  page: import("playwright").Page,
): Promise<CatalogTitleCard[]> {
  await scrollCatalogUntilStable(page)
  return (
    ((await page.evaluate(CATALOG_TITLE_CARDS_EVAL)) as CatalogTitleCard[]) ??
    []
  )
}

async function gotoVendidos(page: import("playwright").Page): Promise<void> {
  const nav = page.locator('a.nav-link[href="/app/catalog/sold"]').first()
  try {
    if (await nav.isVisible({ timeout: 3_000 })) {
      await nav.click({ timeout: 5_000 })
      await page.waitForTimeout(2_000)
      return
    }
  } catch {
    // fall through
  }
  await page.goto(CATALOG_SOLD_URL, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  })
  await page.waitForTimeout(2_000)
}

function uniqueHrefs(cards: CatalogTitleCard[]): string[] {
  const hrefs: string[] = []
  const seen = new Set<string>()
  for (const card of cards) {
    const href = wallapopItemSlugHrefOrNull(card.href)
    if (!href || seen.has(href)) continue
    seen.add(href)
    hrefs.push(href)
  }
  return hrefs
}

async function readItemPage(
  page: import("playwright").Page,
  href: string,
  cardTitle: string,
): Promise<ItemPageFacts> {
  await page.goto(href, { waitUntil: "domcontentloaded", timeout: 45_000 })
  await page
    .locator('meta[property="og:title"]')
    .first()
    .waitFor({ state: "attached", timeout: 15_000 })
    .catch(() => {})
  const raw = ((await page.evaluate(ITEM_PAGE_FACTS_EVAL)) ??
    {}) as Partial<ItemPageFacts>
  const title = String(raw.title ?? "").trim() || cardTitle
  return {
    href: wallapopItemSlugHrefOrNull(raw.href) ?? href,
    title,
    description: String(raw.description ?? "").trim(),
    priceText: String(raw.priceText ?? "").trim(),
  }
}

async function loadCrmListings(): Promise<ItemPageCrmListing[]> {
  const prisma = getPrisma()
  if (!prisma) throw new Error("DATABASE_URL is missing.")
  const accountId = await findDefaultAccountId(prisma)
  if (!accountId) throw new Error("No default account.")
  const rows = await prisma.productListing.findMany({
    where: { accountId },
    select: {
      id: true,
      status: true,
      externalUrl: true,
      product: {
        select: { sku: true, title: true, description: true, price: true },
      },
    },
  })
  return rows.map((row) => ({
    listingId: row.id,
    sku: row.product.sku,
    title: row.product.title,
    description: row.product.description,
    externalUrl: row.externalUrl,
    status: row.status,
    priceEur: Number(row.product.price),
  }))
}

async function main() {
  const apply = process.argv.includes("--apply")
  const browser = await chromium.connectOverCDP(CDP)
  const ctx = browser.contexts()[0]
  if (!ctx) throw new Error("Chrome CDP has no context.")
  const page = await ctx.newPage()
  const cards: CatalogTitleCard[] = []
  const pages: ItemPageFacts[] = []
  try {
    await page.goto(CATALOG_PUBLISHED_URL, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    })
    await page.waitForTimeout(2_000)
    cards.push(...(await scrapeCards(page)))
    await gotoVendidos(page)
    cards.push(...(await scrapeCards(page)))

    const listings = await loadCrmListings()
    const taken = new Set(
      listings
        .map((row) => wallapopItemSlugHrefOrNull(row.externalUrl))
        .filter((href): href is string => href != null),
    )
    const liveMissing = listings.filter(
      (row) => isLive(row.status) && wallapopItemSlugHrefOrNull(row.externalUrl) == null,
    )
    const forPlan: ItemPageCrmListing[] = listings.map((row) =>
      isLive(row.status) ? row : { ...row, status: "READY_TO_POST" },
    )

    const titleByHref = new Map<string, string>()
    for (const card of cards) {
      const href = wallapopItemSlugHrefOrNull(card.href)
      if (href && !titleByHref.has(href)) titleByHref.set(href, card.title)
    }
    const toVisit = uniqueHrefs(cards).filter((href) => !taken.has(href))

    console.log(
      JSON.stringify(
        {
          catalogCards: cards.length,
          uniqueCatalogUrls: uniqueHrefs(cards).length,
          liveMissing: liveMissing.map((row) => row.sku),
          toVisit: toVisit.length,
        },
        null,
        2,
      ),
    )

    for (const href of toVisit) {
      const facts = await readItemPage(page, href, titleByHref.get(href) ?? "")
      pages.push(facts)
      console.log(
        `VISIT  ${facts.href}  title="${facts.title}"  desc=${facts.description.length}c`,
      )
    }

    const plan = await planItemPageUrlLinks(forPlan, pages)
    console.log(
      JSON.stringify(
        {
          apply,
          pagesRead: pages.length,
          links: plan.links.length,
          llmCalls: plan.llmCalls,
          skips: plan.skips.length,
        },
        null,
        2,
      ),
    )
    for (const link of plan.links) {
      const note = link.reason ? `  (${link.reason})` : ""
      console.log(`MATCH  ${link.sku}  ${link.title}  ->  ${link.href}${note}`)
    }
    for (const skip of plan.skips) {
      console.log(
        `SKIP   ${skip.reason}  ${skip.sku ?? ""}  ${skip.title}`.trim(),
      )
    }

    const invalid = plan.links.filter(
      (link) => !wallapopItemSlugHrefOrNull(link.href),
    )
    if (invalid.length > 0) {
      throw new Error(`${invalid.length} invalid /item/ URL(s).`)
    }

    if (!apply) {
      console.log("Dry-run. Re-run with --apply to write external_url.")
      return
    }

    const prisma = getPrisma()
    if (!prisma) throw new Error("DATABASE_URL is missing.")
    const allowed = new Set(liveMissing.map((row) => row.listingId))
    let wrote = 0
    for (const link of plan.links) {
      if (!allowed.has(link.listingId)) continue
      await prisma.productListing.update({
        where: { id: link.listingId },
        data: { externalUrl: link.href },
      })
      wrote += 1
    }
    console.log(`Wrote ${wrote} external_url rows.`)
  } finally {
    await page.close().catch(() => {})
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
