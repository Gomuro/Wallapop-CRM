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
  toMissing: string[]
  toSoldProductIds: string[]
  orphanPublished: string[]
  orphanSold: string[]
}

export type LinkedSaleListing = {
  productId: string
  externalUrl: string | null
}

/** What a sold account's saved /item/ still means in this catalog scrape. */
export type LinkedSalePlan = {
  /** Gone from En venta and from Vendidos. The ad was deleted after the sale. */
  removedProductIds: string[]
  /** Back in En venta without a sold badge. The purchase was cancelled. */
  relistedProductIds: string[]
  /** Still in Vendidos with the sold badge. */
  stillSoldProductIds: string[]
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
 * Live CRM /item/ missing from En venta and from Vendidos sold-badge rows.
 * Both catalogs empty: scrape failed — leave CRM alone.
 */
function missingFromBothCatalogs(
  byListing: Map<string, MonitorCrmListing>,
  byPublished: Map<string, PublishedCatalogRow>,
  soldKeys: Set<string>,
) {
  if (byPublished.size === 0 && soldKeys.size === 0) return []
  const toMissing: string[] = []
  for (const [key, listing] of byListing) {
    if (listing.status !== "ACTIVE" && listing.status !== "RESERVED") continue
    if (byPublished.has(key) || soldKeys.has(key)) continue
    toMissing.push(listing.id)
  }
  return toMissing
}

export type ItemLiveProbe = "live" | "gone" | "unknown"

/** Catalog candidates stay unchanged unless the live /item/ page is gone. */
export function missingIdsAfterItemProbes(
  candidateIds: string[],
  probes: Record<string, ItemLiveProbe>,
): string[] {
  return candidateIds.filter((id) => probes[id] === "gone")
}

const EMPTY_LINKED_SALES: LinkedSalePlan = {
  removedProductIds: [],
  relistedProductIds: [],
  stillSoldProductIds: [],
}

function hrefKeys(rows: { href: string }[]): Set<string> {
  const keys = new Set<string>()
  for (const row of rows) {
    const key = wallapopItemPathKey(row.href)
    if (key) keys.add(key)
  }
  return keys
}

function soldCatalogKeys(rows: SoldCatalogRow[]): {
  vendidos: Set<string>
  soldBadge: Set<string>
} {
  const vendidos = new Set<string>()
  const soldBadge = new Set<string>()
  for (const row of rows) {
    const key = wallapopItemPathKey(row.href)
    if (!key) continue
    vendidos.add(key)
    if (row.sold !== false) soldBadge.add(key)
  }
  return { vendidos, soldBadge }
}

function classifyLinkedSale(
  listing: { key: string; productId: string },
  keys: { published: Set<string>; vendidos: Set<string>; soldBadge: Set<string> },
  buckets: { removed: Set<string>; relisted: Set<string>; stillSold: Set<string> },
): void {
  if (keys.soldBadge.has(listing.key)) {
    buckets.stillSold.add(listing.productId)
    return
  }
  if (keys.published.has(listing.key)) {
    buckets.relisted.add(listing.productId)
    return
  }
  if (!keys.vendidos.has(listing.key)) buckets.removed.add(listing.productId)
}

/**
 * A sale we already recorded on this account. Empty catalogs mean the scrape
 * failed, so nothing is cancelled. A sold badge wins over En venta.
 */
export function planLinkedSales(
  published: { href: string }[],
  sold: SoldCatalogRow[],
  listings: LinkedSaleListing[],
): LinkedSalePlan {
  if (published.length === 0 && sold.length === 0) return EMPTY_LINKED_SALES
  const publishedKeys = hrefKeys(published)
  const soldKeys = soldCatalogKeys(sold)
  const removed = new Set<string>()
  const relisted = new Set<string>()
  const stillSold = new Set<string>()
  for (const listing of listings) {
    const key = wallapopItemPathKey(listing.externalUrl)
    if (!key) continue
    classifyLinkedSale(
      { key, productId: listing.productId },
      {
        published: publishedKeys,
        vendidos: soldKeys.vendidos,
        soldBadge: soldKeys.soldBadge,
      },
      { removed, relisted, stillSold },
    )
  }
  return {
    removedProductIds: [...removed],
    relistedProductIds: [...relisted],
    stillSoldProductIds: [...stillSold],
  }
}

/**
 * Match only `/item/` href ↔ listing.externalUrl. Never title.
 * Sold wins over En venta. A live /item/ in neither catalog is a MISSING
 * candidate until the item page confirms it.
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
    toMissing: missingFromBothCatalogs(byListing, byPublished, soldKeys),
    toSoldProductIds: soldPlan.toSoldProductIds,
    orphanPublished: orphanHrefs(published, byListing, false),
    orphanSold: orphanHrefs(sold, byListing, true),
  }
}
