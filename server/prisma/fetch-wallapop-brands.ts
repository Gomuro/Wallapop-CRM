import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  flattenWallapopCategories,
  type WallapopApiNode,
} from "./flatten-wallapop-categories"
import { resolveBrandHttp } from "./wallapop-bearer"
import {
  BRAND_AUTH_PROBE_LEAF,
  fetchAllBrandOptionsForLeaf,
  fetchBrandOptionsPage,
  fingerprintBrandPage,
  type WallapopBrandCatalog,
  type WallapopBrandOption,
  type WallapopBrandsSnapshot,
} from "./wallapop-brand-options"

const here = dirname(fileURLToPath(import.meta.url))
const CATEGORIES_SNAPSHOT = join(here, "data", "wallapop-categories.json")
const SNAPSHOT_PATH = join(here, "data", "wallapop-brands.json")

function loadCategoryLeaves(): number[] {
  const raw = JSON.parse(readFileSync(CATEGORIES_SNAPSHOT, "utf8")) as {
    categories?: WallapopApiNode[]
  }
  const rows = flattenWallapopCategories(raw)
  return rows.filter((row) => row.isLeaf).map((row) => row.wallapopId)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const http = await resolveBrandHttp()
  const probe = await fetchBrandOptionsPage(http, BRAND_AUTH_PROBE_LEAF)
  if (probe.results.length === 0) {
    throw new Error(
      `Wallapop brand options empty for leaf ${BRAND_AUTH_PROBE_LEAF}. Log in on Chrome CDP or set WALLAPOP_BEARER.`,
    )
  }

  const leaves = loadCategoryLeaves()
  const catalogs: WallapopBrandCatalog[] = []
  const byFingerprint = new Map<string, WallapopBrandCatalog>()

  for (let i = 0; i < leaves.length; i += 1) {
    const leaf = leaves[i]
    if (i > 0 && i % 50 === 0) {
      console.log(`scanned ${i}/${leaves.length} leaves catalogs=${catalogs.length}`)
    }
    const page = await fetchBrandOptionsPage(http, leaf)
    await sleep(40)
    if (page.results.length === 0) continue
    const fingerprint = fingerprintBrandPage(page.results)
    const existing = byFingerprint.get(fingerprint)
    if (existing) {
      existing.leafWallapopIds.push(leaf)
      continue
    }
    let brands: WallapopBrandOption[] = page.results
    if (page.nextToken) {
      brands = await fetchAllBrandOptionsForLeaf(http, leaf)
      await sleep(40)
    }
    const catalog: WallapopBrandCatalog = {
      fingerprint,
      brands,
      leafWallapopIds: [leaf],
    }
    byFingerprint.set(fingerprint, catalog)
    catalogs.push(catalog)
    console.log(
      `catalog brands=${brands.length} leaves+=${leaf} catalogs=${catalogs.length}`,
    )
  }

  const snapshot: WallapopBrandsSnapshot = {
    fetchedAt: new Date().toISOString(),
    catalogs,
  }
  mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true })
  writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot)}\n`, "utf8")
  const brandCount = new Set(
    catalogs.flatMap((catalog) => catalog.brands.map((row) => row.id)),
  ).size
  const linkedLeaves = catalogs.reduce(
    (sum, catalog) => sum + catalog.leafWallapopIds.length,
    0,
  )
  console.log(`wrote ${SNAPSHOT_PATH}`)
  console.log(
    `catalogs=${catalogs.length} uniqueBrands=${brandCount} linkedLeaves=${linkedLeaves}/${leaves.length}`,
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
