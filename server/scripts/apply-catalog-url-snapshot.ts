/**
 * Apply external_url from a saved dry-run (no Chrome).
 *
 *   npx tsx server/scripts/apply-catalog-url-snapshot.ts
 *   npx tsx server/scripts/apply-catalog-url-snapshot.ts --apply
 *   npx tsx server/scripts/apply-catalog-url-snapshot.ts --apply --overwrite
 */
import "../load-env"

import fs from "node:fs"
import path from "node:path"

import { wallapopItemSlugHrefOrNull } from "../../lib/inventory/wallapop-item-url"
import { findDefaultAccountId } from "../src/lib/default-account"
import { getPrisma } from "../src/lib/db"

const DEFAULT_SNAPSHOT = path.join(
  __dirname,
  "../prisma/data/catalog-url-link-snapshot.txt",
)

export type SnapshotRow = { sku: string; href: string; source: string }

const MATCH_LINE =
  /^MATCH\s+(RULE|LLM)\s+(\S+)\s+.+\s+->\s+(https:\/\/es\.wallapop\.com\/item\/[^\s(]+)/

export function parseSnapshotText(text: string): SnapshotRow[] {
  const rows: SnapshotRow[] = []
  const seenSku = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const m = MATCH_LINE.exec(trimmed)
    if (!m) continue
    const href = wallapopItemSlugHrefOrNull(m[3])
    if (!href) continue
    const sku = m[2]
    if (seenSku.has(sku)) continue
    seenSku.add(sku)
    rows.push({ sku, href, source: m[1] })
  }
  return rows
}

async function main() {
  const apply = process.argv.includes("--apply")
  const overwrite = process.argv.includes("--overwrite")
  const fileArg = process.argv.find((a) => a.endsWith(".txt"))
  const file = fileArg ? path.resolve(fileArg) : DEFAULT_SNAPSHOT
  const text = fs.readFileSync(file, "utf8")
  const snapshot = parseSnapshotText(text)
  if (snapshot.length === 0) {
    throw new Error(`No MATCH lines in ${file}`)
  }

  const prisma = getPrisma()
  if (!prisma) throw new Error("DATABASE_URL is missing.")
  const accountId = await findDefaultAccountId(prisma)
  if (!accountId) throw new Error("No default account.")

  const bySku = new Map(
    (
      await prisma.productListing.findMany({
        where: { accountId },
        select: {
          id: true,
          externalUrl: true,
          product: { select: { sku: true } },
        },
      })
    ).map((row) => [row.product.sku, row]),
  )

  let wouldWrite = 0
  let skippedHasUrl = 0
  let missingSku = 0
  const hrefUsed = new Map<string, string>()

  for (const row of snapshot) {
    const listing = bySku.get(row.sku)
    if (!listing) {
      missingSku += 1
      console.log(`MISSING_SKU  ${row.sku}`)
      continue
    }
    const cur = wallapopItemSlugHrefOrNull(listing.externalUrl)
    if (cur && !overwrite) {
      if (cur === row.href) continue
      skippedHasUrl += 1
      console.log(`SKIP_HAS_URL  ${row.sku}  current=${cur}`)
      continue
    }
    const owner = hrefUsed.get(row.href)
    if (owner && owner !== row.sku) {
      console.log(`SKIP_DUP_HREF  ${row.sku}  shares ${row.href} with ${owner}`)
      continue
    }
    hrefUsed.set(row.href, row.sku)
    wouldWrite += 1
    console.log(`APPLY  ${row.source}  ${row.sku}  ->  ${row.href}`)
    if (apply) {
      await prisma.productListing.update({
        where: { id: listing.id },
        data: { externalUrl: row.href },
      })
    }
  }

  console.log(
    JSON.stringify(
      {
        apply,
        overwrite,
        snapshotFile: file,
        snapshotRows: snapshot.length,
        wouldWrite,
        skippedHasUrl,
        missingSku,
      },
      null,
      2,
    ),
  )
  if (!apply) {
    console.log("Dry-run. Re-run with --apply to write external_url.")
  } else {
    console.log(`Wrote ${wouldWrite} external_url rows.`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
