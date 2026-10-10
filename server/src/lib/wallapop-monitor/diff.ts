import { wallapopItemPathKey } from "../../../../lib/inventory/wallapop-item-url"
import type { PublishedCatalogRow } from "./catalog"

export type SoldCatalogRow = {
  href: string
  sold: boolean
}

export type MonitorCrmListing = {
  id: string
  productId: string
  status: string
  externalUrl: string | null
}

export type MonitorPlan = {
  toReserved: string[]
  toActive: string[]
  toSoldProductIds: string[]
  orphanPublished: string[]
  orphanSold: string[]
}

function listingByItemKey(
  listings: MonitorCrmListing[],
): Map<string, MonitorCrmListing> {
  const map = new Map<string, MonitorCrmListing>()
  for (const listing of listings) {
    const key = wallapopItemPathKey(listing.externalUrl)
    if (!key || map.has(key)) continue
    map.set(key, listing)
  }
  return map
}

function publishedByItemKey(
  rows: PublishedCatalogRow[],
): Map<string, PublishedCatalogRow> {
  const map = new Map<string, PublishedCatalogRow>()
  for (const row of rows) {
    const key = wallapopItemPathKey(row.href)
    if (!key || map.has(key)) continue
    map.set(key, row)
  }
  return map
}

function soldItemKeys(rows: SoldCatalogRow[]): Set<string> {
  const keys = new Set<string>()
  for (const row of rows) {
    if (!row.sold) continue
    const key = wallapopItemPathKey(row.href)
    if (key) keys.add(key)
  }
  return keys
}

function orphanHrefs(
  rows: { href: string; sold?: boolean }[],
  byListing: Map<string, MonitorCrmListing>,
  soldOnly: boolean,
) {
  const orphan: string[] = []
  for (const row of rows) {
    if (soldOnly && !row.sold) continue
    const key = wallapopItemPathKey(row.href)
    if (!key || byListing.has(key)) continue
    orphan.push(row.href)
  }
  return orphan
}

function soldFromCatalog(
  byListing: Map<string, MonitorCrmListing>,
  soldKeys: Set<string>,
) {
  const toSoldProductIds: string[] = []
  const soldProductIds = new Set<string>()
  const soldListingIds = new Set<string>()
  for (const [key, listing] of byListing) {
    if (!soldKeys.has(key) || soldProductIds.has(listing.productId)) continue
    soldProductIds.add(listing.productId)
    soldListingIds.add(listing.id)
    toSoldProductIds.push(listing.productId)
  }
  return { toSoldProductIds, soldProductIds, soldListingIds }
}

function reservedAndActive(
  byListing: Map<string, MonitorCrmListing>,
  byPublished: Map<string, PublishedCatalogRow>,
  soldListingIds: Set<string>,
  soldProductIds: Set<string>,
) {
  const toReserved: string[] = []
  const toActive: string[] = []
  for (const [key, listing] of byListing) {
    if (soldListingIds.has(listing.id) || soldProductIds.has(listing.productId)) {
      continue
    }
    const row = byPublished.get(key)
    if (!row) continue
    if (row.reserved && listing.status !== "RESERVED") {
      toReserved.push(listing.id)
    }
    if (!row.reserved && listing.status === "RESERVED") {
      toActive.push(listing.id)
    }
  }
  return { toReserved, toActive }
}

/**
 * Match only `/item/` href ↔ listing.externalUrl. Never title.
 * Sold wins over En venta. Unseen rows: no change (do not un-SOLD / un-RESERVED).
 */
export function planMonitorUpdates(
  published: PublishedCatalogRow[],
  sold: SoldCatalogRow[],
  listings: MonitorCrmListing[],
): MonitorPlan {
  const byListing = listingByItemKey(listings)
  const byPublished = publishedByItemKey(published)
  const soldKeys = soldItemKeys(sold)
  const soldPlan = soldFromCatalog(byListing, soldKeys)
  const reserved = reservedAndActive(
    byListing,
    byPublished,
    soldPlan.soldListingIds,
    soldPlan.soldProductIds,
  )
  return {
    ...reserved,
    toSoldProductIds: soldPlan.toSoldProductIds,
    orphanPublished: orphanHrefs(published, byListing, false),
    orphanSold: orphanHrefs(sold, byListing, true),
  }
}
