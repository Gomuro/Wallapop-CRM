/**
 * Fill listing.external_url: deterministic title match + Groq Qwen for the rest.
 * Chrome CDP + GROQ_API_KEY. Does not quit Chrome.
 *
 *   npx tsx server/scripts/link-catalog-urls-llm.ts
 *   npx tsx server/scripts/link-catalog-urls-llm.ts --apply
 */
import "../load-env"

import { chromium } from "playwright"

import { findDefaultAccountId } from "../src/lib/default-account"
import { getPrisma } from "../src/lib/db"
import {
  CATALOG_PUBLISHED_URL,
  CATALOG_SOLD_URL,
} from "../src/lib/wallapop-monitor/catalog"
import {
  CATALOG_TITLE_CARDS_EVAL,
  listingMayBeOnWallapop,
  type CatalogTitleCard,
} from "../src/lib/wallapop-monitor/link-by-title"
import {
  planCombinedTitleUrlLinks,
  type CrmLinkListing,
} from "../src/lib/wallapop-monitor/link-by-title-llm"
import { scrollCatalogUntilStable } from "../src/lib/wallapop-monitor/scrape"

const CDP = process.env.WALLAPOP_CDP_URL?.trim() || "http://127.0.0.1:9222"

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

async function loadCrmListings(): Promise<CrmLinkListing[]> {
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
      product: { select: { sku: true, title: true, price: true } },
    },
  })
  return rows.map((row) => ({
    listingId: row.id,
    sku: row.product.sku,
    title: row.product.title,
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
  try {
    await page.goto(CATALOG_PUBLISHED_URL, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    })
    await page.waitForTimeout(2_000)
    cards.push(...(await scrapeCards(page)))
    await gotoVendidos(page)
    cards.push(...(await scrapeCards(page)))
  } finally {
    await page.close().catch(() => {})
  }

  const listings = await loadCrmListings()
  const plan = await planCombinedTitleUrlLinks(listings, cards)
  const detCount = plan.links.filter((l) => l.source === "deterministic").length
  const llmCount = plan.links.filter((l) => l.source === "llm").length

  console.log(
    JSON.stringify(
      {
        apply,
        catalogCards: cards.length,
        crmListings: listings.length,
        crmOnWallapop: listings.filter((row) =>
          listingMayBeOnWallapop(row.status),
        ).length,
        links: plan.links.length,
        deterministic: detCount,
        llm: llmCount,
        llmCalls: plan.llmCalls,
        skips: plan.skips.length,
        skipReasons: plan.skips.reduce<Record<string, number>>((acc, skip) => {
          acc[skip.reason] = (acc[skip.reason] ?? 0) + 1
          return acc
        }, {}),
      },
      null,
      2,
    ),
  )

  for (const link of plan.links) {
    const tag = link.source === "llm" ? "LLM" : "RULE"
    const note = link.reason ? `  (${link.reason})` : ""
    console.log(
      `MATCH  ${tag}  ${link.sku}  ${link.title}  ->  ${link.href}${note}`,
    )
  }
  for (const skip of plan.skips) {
    console.log(
      `SKIP   ${skip.reason}  ${skip.sku ?? ""}  ${skip.title}`.trim(),
    )
  }

  if (!apply) {
    console.log("Dry-run. Re-run with --apply to write external_url.")
    return
  }

  const prisma = getPrisma()
  if (!prisma) throw new Error("DATABASE_URL is missing.")
  for (const link of plan.links) {
    await prisma.productListing.update({
      where: { id: link.listingId },
      data: { externalUrl: link.href },
    })
  }
  console.log(`Wrote ${plan.links.length} external_url rows.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
