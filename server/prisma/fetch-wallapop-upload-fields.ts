import "../load-env"

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  flattenWallapopCategories,
  type WallapopApiNode,
} from "./flatten-wallapop-categories"
import {
  catalogFromPayload,
  postUploadComponents,
  resolveUploadComponentsBearer,
  uploadComponentsBody,
  type UploadFieldsCatalog,
  type UploadFieldsSnapshot,
} from "./wallapop-upload-components"

const here = dirname(fileURLToPath(import.meta.url))
const CATEGORIES_SNAPSHOT = join(here, "data", "wallapop-categories.json")
const SNAPSHOT_PATH = join(here, "data", "wallapop-upload-fields.json")

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function loadLeaves(): Array<{ wallapopId: number; rootId: string; nameEs: string }> {
  const raw = JSON.parse(readFileSync(CATEGORIES_SNAPSHOT, "utf8")) as {
    categories?: WallapopApiNode[]
  }
  return flattenWallapopCategories(raw)
    .filter((row) => row.isLeaf)
    .map((row) => ({
      wallapopId: row.wallapopId,
      rootId: row.path.split("/").filter(Boolean)[0] ?? "",
      nameEs: row.nameEs,
    }))
}

async function main() {
  const bearer = await resolveUploadComponentsBearer()
  const leaves = loadLeaves()
  const catalogs: UploadFieldsCatalog[] = []
  const byFingerprint = new Map<string, UploadFieldsCatalog>()
  let failed = 0

  for (let i = 0; i < leaves.length; i += 1) {
    const leaf = leaves[i]
    if (i > 0 && i % 50 === 0) {
      console.log(
        `scanned ${i}/${leaves.length} catalogs=${catalogs.length} failed=${failed}`,
      )
    }
    const body = uploadComponentsBody(
      leaf.wallapopId,
      leaf.rootId,
      `CRM leaf ${leaf.nameEs}`,
    )
    const { status, json } = await postUploadComponents(bearer, body)
    await sleep(40)
    if (status < 200 || status >= 300) {
      failed += 1
      console.warn(`leaf ${leaf.wallapopId} HTTP ${status}`)
      continue
    }
    const parsed = catalogFromPayload(json, leaf.wallapopId)
    const existing = byFingerprint.get(parsed.fingerprint)
    if (existing) {
      existing.leafWallapopIds.push(leaf.wallapopId)
      continue
    }
    byFingerprint.set(parsed.fingerprint, parsed)
    catalogs.push(parsed)
  }

  const snapshot: UploadFieldsSnapshot = {
    fetchedAt: new Date().toISOString(),
    catalogs,
  }
  mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true })
  writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot)}\n`, "utf8")
  const linked = catalogs.reduce(
    (sum, catalog) => sum + catalog.leafWallapopIds.length,
    0,
  )
  console.log(`wrote ${SNAPSHOT_PATH}`)
  console.log(
    `catalogs=${catalogs.length} linkedLeaves=${linked}/${leaves.length} failed=${failed}`,
  )
  process.exit(failed === leaves.length ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
