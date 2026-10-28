import type { ListingStatus, PrismaClient } from "../../generated/prisma/client"

import { wallapopItemUrlOrNull } from "../../../lib/inventory/wallapop-item-url"
import { findDefaultAccountId } from "./default-account"
import { log } from "./log"
import { isWallapopOffline } from "./wallapop-offline"
import { listingJsonSelect, toListingJson } from "./listing-json"
import {
  fetchSellerPublishedItems,
  sellerUserIdFromItemHtml,
  type LiveCatalogItem,
} from "./wallapop-live-catalog"
import { planLiveMarks, type CrmLiveRow, type LiveMark } from "./wallapop-live-mark"

const QUEUE_STATUSES = new Set(["READY_TO_POST", "FAILED"])
const TRUTH_FROM = new Set([
  "READY_TO_POST",
  "FAILED",
  "DEACTIVATED",
  "ACTIVE",
  "RESERVED",
])

const sellerUserIdByAccount = new Map<string, string>()

export function resetSellerUserIdCacheForTests(): void {
  sellerUserIdByAccount.clear()
}

const LIVE_TEXT_SELECT = {
  variantTitle: true,
  variantPrice: true,
  product: { select: { sku: true, title: true, price: true, status: true } },
} as const

/** A duplicate is on Wallapop under its own title and ,98 price, not the product's. */
export function liveText(row: {
  variantTitle: string | null
  variantPrice: { toString(): string } | null
  product: { title: string; price: { toString(): string } }
}) {
  return {
    title: row.variantTitle ?? row.product.title,
    price: Number((row.variantPrice ?? row.product.price).toString()),
  }
}

export async function loadCrmLiveRows(prisma: PrismaClient): Promise<CrmLiveRow[]> {
  const rows = await prisma.productListing.findMany({
    where: { account: { isDefault: true } },
    select: {
      id: true,
      status: true,
      externalUrl: true,
      ...LIVE_TEXT_SELECT,
    },
  })
  return rows.map((row) => ({
    listingId: row.id,
    sku: row.product.sku,
    ...liveText(row),
    productStatus: row.product.status,
    listingStatus: row.status,
    externalUrl: row.externalUrl,
  }))
}

async function resolveSellerUserId(
  prisma: PrismaClient,
  accountId: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const cached = sellerUserIdByAccount.get(accountId)
  if (cached) return cached
  // Stored id first: item HTML answers 403 from the VPS, the JSON API does not.
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { wallapopUserId: true },
  })
  const stored = account?.wallapopUserId?.trim()
  if (stored) {
    sellerUserIdByAccount.set(accountId, stored)
    return stored
  }
  const row = await prisma.productListing.findFirst({
    where: {
      accountId,
      externalUrl: { contains: "/item/" },
    },
    select: { externalUrl: true },
    orderBy: { lastPostedAt: { sort: "desc", nulls: "last" } },
  })
  const href = wallapopItemUrlOrNull(row?.externalUrl)
  if (!href) return null
  const response = await fetchImpl(href, {
    headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) return null
  const userId = sellerUserIdFromItemHtml(await response.text())
  if (userId) sellerUserIdByAccount.set(accountId, userId)
  return userId
}

async function loadSellerCatalog(
  prisma: PrismaClient,
  accountId: string,
): Promise<LiveCatalogItem[] | null> {
  if (isWallapopOffline()) return null
  try {
    const userId = await resolveSellerUserId(prisma, accountId, fetch)
    if (!userId) {
      log("warn", "wallapop_live_catalog_no_seller", { accountId })
      return null
    }
    const items = await fetchSellerPublishedItems(userId)
    log("info", "wallapop_live_catalog", { accountId, count: items.length })
    return items
  } catch (error) {
    log("warn", "wallapop_live_catalog_failed", {
      accountId,
      message: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

async function loadDefaultSellerCatalog(
  prisma: PrismaClient,
): Promise<LiveCatalogItem[] | null> {
  const accountId = await findDefaultAccountId(prisma)
  if (!accountId) return null
  return loadSellerCatalog(prisma, accountId)
}

async function loadAccountLiveRows(
  prisma: PrismaClient,
  accountId: string,
): Promise<CrmLiveRow[]> {
  const rows = await prisma.productListing.findMany({
    where: { accountId },
    select: {
      id: true,
      status: true,
      externalUrl: true,
      ...LIVE_TEXT_SELECT,
    },
  })
  return rows.map((row) => ({
    listingId: row.id,
    sku: row.product.sku,
    ...liveText(row),
    productStatus: row.product.status,
    listingStatus: row.status,
    externalUrl: row.externalUrl,
  }))
}

async function writeLiveMark(
  prisma: PrismaClient,
  row: CrmLiveRow,
  mark: LiveMark,
): Promise<boolean> {
  if (mark.action === "leave") return false
  const data =
    mark.action === "hanging"
      ? {
          status: mark.status,
          externalUrl: mark.externalUrl,
          lastPublishError: null,
          postingAttempts: 0,
          ...(row.listingStatus === "ACTIVE" || row.listingStatus === "RESERVED"
            ? {}
            : { lastPostedAt: new Date() }),
        }
      : { status: "DEACTIVATED" as const, externalUrl: null }
  const result = await prisma.productListing.updateMany({
    where: { id: row.listingId, status: row.listingStatus as ListingStatus },
    data,
  })
  return result.count > 0
}

function shouldWrite(mark: LiveMark, row: CrmLiveRow, clearMissing: boolean): boolean {
  if (mark.action === "hanging") {
    const allowed = clearMissing ? TRUTH_FROM : QUEUE_STATUSES
    return allowed.has(row.listingStatus)
  }
  return clearMissing && mark.action === "not_hanging"
}

export async function syncListingsWithLiveCatalog(
  prisma: PrismaClient,
  options: { clearMissing: boolean },
): Promise<{ hanging: number; notHanging: number; ambiguous: string[] }> {
  const items = await loadDefaultSellerCatalog(prisma)
  if (!items) return { hanging: 0, notHanging: 0, ambiguous: [] }
  const rows = await loadCrmLiveRows(prisma)
  const byId = new Map(rows.map((row) => [row.listingId, row]))
  const summary = { hanging: 0, notHanging: 0, ambiguous: [] as string[] }
  for (const mark of planLiveMarks(rows, items)) {
    if (mark.action === "leave" && mark.reason === "ambiguous") {
      summary.ambiguous.push(mark.sku)
    }
    const row = byId.get(mark.listingId)
    if (!row || !shouldWrite(mark, row, options.clearMissing)) continue
    const wrote = await writeLiveMark(prisma, row, mark)
    if (!wrote) continue
    if (mark.action === "hanging") {
      summary.hanging += 1
      log("info", "wallapop_already_live", {
        sku: mark.sku,
        status: mark.status,
        externalUrl: mark.externalUrl,
        reason: mark.reason,
      })
    } else if (mark.action === "not_hanging") {
      summary.notHanging += 1
      log("info", "wallapop_not_hanging", { sku: mark.sku })
    }
  }
  return summary
}

/** Public profile href for this listing, including one still in POSTING. Any account. */
export async function liveHrefForListing(
  prisma: PrismaClient,
  listingId: string,
): Promise<string | null> {
  const listing = await prisma.productListing.findUnique({
    where: { id: listingId },
    select: { accountId: true },
  })
  if (!listing) return null
  const items = await loadSellerCatalog(prisma, listing.accountId)
  if (!items) return null
  const rows = await loadAccountLiveRows(prisma, listing.accountId)
  const planned = rows.map((row) =>
    row.listingId === listingId
      ? { ...row, listingStatus: "READY_TO_POST", productStatus: "ACTIVE" }
      : row,
  )
  const mark = planLiveMarks(planned, items).find((entry) => entry.listingId === listingId)
  return mark?.action === "hanging" ? mark.externalUrl : null
}

/** READY / FAILED rows that are already on the public profile become En Wallapop. */
export async function linkQueuedListingsAlreadyLive(
  prisma: PrismaClient,
): Promise<number> {
  const summary = await syncListingsWithLiveCatalog(prisma, { clearMissing: false })
  return summary.hanging
}

export async function adoptAlreadyLiveBeforePublish(
  prisma: PrismaClient,
  listingId: string,
) {
  await linkQueuedListingsAlreadyLive(prisma)
  const row = await prisma.productListing.findUnique({
    where: { id: listingId },
    select: listingJsonSelect,
  })
  if (!row) return null
  if (row.status !== "ACTIVE" && row.status !== "RESERVED") return null
  if (!wallapopItemUrlOrNull(row.externalUrl)) return null
  return toListingJson(row)
}
