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

  const orphanPublished: string[] = []
  for (const row of published) {
    const key = wallapopItemPathKey(row.href)
    if (!key) continue
    if (!byListing.has(key)) orphanPublished.push(row.href)
  }

  const orphanSold: string[] = []
  for (const row of sold) {
    if (!row.sold) continue
    const key = wallapopItemPathKey(row.href)
    if (!key) continue
    if (!byListing.has(key)) orphanSold.push(row.href)
  }

  const toSoldProductIds: string[] = []
  const soldProductIds = new Set<string>()
  const soldListingIds = new Set<string>()
  for (const [key, listing] of byListing) {
    if (!soldKeys.has(key) || soldProductIds.has(listing.productId)) continue
    soldProductIds.add(listing.productId)
    soldListingIds.add(listing.id)
    toSoldProductIds.push(listing.productId)
  }

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

  return {
    toReserved,
    toActive,
    toSoldProductIds,
    orphanPublished,
    orphanSold,
  }
}
