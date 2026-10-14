import { wallapopItemPathKey } from "../../../lib/inventory/wallapop-item-url"
import { pickUniqueCatalogItemUrl } from "./wallapop-publish/catalog-url"
import type { LiveCatalogItem } from "./wallapop-live-catalog"

export type CrmLiveRow = {
  listingId: string
  sku: string
  title: string
  price: number
  productStatus: string
  listingStatus: string
  externalUrl: string | null
}

export type LiveMark =
  | {
      action: "leave"
      listingId: string
      sku: string
      reason:
        | "product_not_active"
        | "posting"
        | "already"
        | "ambiguous"
        | "not_listed"
    }
  | {
      action: "hanging"
      listingId: string
      sku: string
      status: "ACTIVE" | "RESERVED"
      externalUrl: string
      reason: "stored_url" | "title"
    }
  | {
      action: "not_hanging"
      listingId: string
      sku: string
      reason: "missing"
    }

function hangingStatus(reserved: boolean): "ACTIVE" | "RESERVED" {
  return reserved ? "RESERVED" : "ACTIVE"
}

function leave(
  row: CrmLiveRow,
  reason: Extract<LiveMark, { action: "leave" }>["reason"],
): LiveMark {
  return { action: "leave", listingId: row.listingId, sku: row.sku, reason }
}

function indexLive(items: LiveCatalogItem[]): Map<string, LiveCatalogItem> {
  const byPath = new Map<string, LiveCatalogItem>()
  for (const item of items) {
    const path = wallapopItemPathKey(item.href)
    if (path) byPath.set(path, item)
  }
  return byPath
}

function markStoredUrl(
  row: CrmLiveRow,
  liveByPath: Map<string, LiveCatalogItem>,
  claimed: Set<string>,
): LiveMark | null {
  if (row.productStatus !== "ACTIVE") return leave(row, "product_not_active")
  if (row.listingStatus === "POSTING") return leave(row, "posting")
  const path = wallapopItemPathKey(row.externalUrl)
  if (!path) return null
  const item = liveByPath.get(path)
  if (!item) return null
  if (claimed.has(path)) return leave(row, "ambiguous")
  claimed.add(path)
  if (row.listingStatus === "ACTIVE" || row.listingStatus === "RESERVED") {
    return leave(row, "already")
  }
  return {
    action: "hanging",
    listingId: row.listingId,
    sku: row.sku,
    status: hangingStatus(item.reserved),
    externalUrl: item.href,
    reason: "stored_url",
  }
}

function markByTitle(
  row: CrmLiveRow,
  items: LiveCatalogItem[],
  claimed: Set<string>,
): LiveMark {
  const open = items.filter((item) => {
    const path = wallapopItemPathKey(item.href)
    return path != null && !claimed.has(path)
  })
  const picked = pickUniqueCatalogItemUrl(open, {
    title: row.title,
    price: row.price,
  })
  if (picked.reason === "ambiguous") return leave(row, "ambiguous")
  if (picked.href) {
    const path = wallapopItemPathKey(picked.href)
    const item = open.find((candidate) => wallapopItemPathKey(candidate.href) === path)
    if (!path || !item) return leave(row, "ambiguous")
    claimed.add(path)
    return {
      action: "hanging",
      listingId: row.listingId,
      sku: row.sku,
      status: hangingStatus(item.reserved),
      externalUrl: item.href,
      reason: "title",
    }
  }
  if (row.listingStatus === "ACTIVE" || row.listingStatus === "RESERVED") {
    return {
      action: "not_hanging",
      listingId: row.listingId,
      sku: row.sku,
      reason: "missing",
    }
  }
  return leave(row, "not_listed")
}

/** Decide which CRM rows are on the public seller catalog and which are not. */
export function planLiveMarks(
  rows: CrmLiveRow[],
  items: LiveCatalogItem[],
): LiveMark[] {
  const ordered = [...rows].sort((left, right) => left.sku.localeCompare(right.sku))
  const liveByPath = indexLive(items)
  const claimed = new Set<string>()
  const pending: CrmLiveRow[] = []
  const marks: LiveMark[] = []
  for (const row of ordered) {
    const stored = markStoredUrl(row, liveByPath, claimed)
    if (stored) marks.push(stored)
    else pending.push(row)
  }
  for (const row of pending) marks.push(markByTitle(row, items, claimed))
  return marks
}
