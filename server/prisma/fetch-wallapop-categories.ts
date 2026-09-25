import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  flattenWallapopCategories,
  WALLAPOP_TREE_COUNTS,
  type WallapopApiNode,
} from "./flatten-wallapop-categories"

const CATEGORIES_URL =
  "https://api.wallapop.com/api/v3/categories?context=search"

const SNAPSHOT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "data",
  "wallapop-categories.json",
)

async function fetchTree(): Promise<{ categories?: WallapopApiNode[] }> {
  const response = await fetch(CATEGORIES_URL, {
    headers: {
      Accept: "application/json",
      "Accept-Language": "es",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
  })
  if (!response.ok) {
    throw new Error(
      `Wallapop categories HTTP ${response.status} ${response.statusText}`,
    )
  }
  return (await response.json()) as { categories?: WallapopApiNode[] }
}

async function main() {
  const payload = await fetchTree()
  const rows = flattenWallapopCategories(payload)
  const roots = rows.filter((row) => row.parentWallapopId === null)
  const leaves = rows.filter((row) => row.isLeaf).length
  const maxDepth = Math.max(...rows.map((row) => row.depth))

  mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true })
  writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(payload)}\n`, "utf8")

  console.log(`wrote ${SNAPSHOT_PATH}`)
  console.log(
    `roots=${roots.length} nodes=${rows.length} leaves=${leaves} maxDepth=${maxDepth}`,
  )
  for (const row of roots) {
    console.log(
      `${row.nameEs} wallapopId=${row.wallapopId} sortOrder=${row.sortOrder}`,
    )
  }

  if (
    roots.length !== WALLAPOP_TREE_COUNTS.roots ||
    rows.length !== WALLAPOP_TREE_COUNTS.nodes ||
    leaves !== WALLAPOP_TREE_COUNTS.leaves ||
    maxDepth !== WALLAPOP_TREE_COUNTS.maxDepth
  ) {
    console.warn(
      `taxonomy drift: expected ${WALLAPOP_TREE_COUNTS.roots}/${WALLAPOP_TREE_COUNTS.nodes}/${WALLAPOP_TREE_COUNTS.leaves}/${WALLAPOP_TREE_COUNTS.maxDepth}`,
    )
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
