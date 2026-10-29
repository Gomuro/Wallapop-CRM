import { wallapopItemUrlOrNull } from "../../../lib/inventory/wallapop-item-url"

export type LiveCatalogItem = {
  id: string
  href: string
  title: string
  price: number
  priceText: string
  reserved: boolean
}

/** ~39 items per page; 507 live items on 2026-10-28 already needed 13 pages. */
const PAGE_CAP = 60

export function priceTextFromAmount(amount: number): string {
  return amount.toFixed(2).replace(".", ",")
}

function cashAmount(price: unknown): number | null {
  if (typeof price === "number" && Number.isFinite(price)) return price
  if (!price || typeof price !== "object") return null
  const record = price as { amount?: unknown; cash?: { amount?: unknown } }
  if (typeof record.amount === "number" && Number.isFinite(record.amount)) {
    return record.amount
  }
  const nested = record.cash?.amount
  if (typeof nested === "number" && Number.isFinite(nested)) return nested
  return null
}

/**
 * api/v3/users/{id}/items marks a reserve as `reserved: { flag: true }` (seen 2026-10-29);
 * there is no `isReserved` on that page. Reading only `isReserved` made every ad look free
 * and the monitor cleared 12 reserves.
 */
function isReservedRecord(record: { isReserved?: unknown; reserved?: unknown }): boolean {
  if (record.isReserved === true) return true
  const reserved = record.reserved as { flag?: unknown } | boolean | null | undefined
  if (reserved === true) return true
  return typeof reserved === "object" && reserved !== null && reserved.flag === true
}

function itemFromRecord(row: unknown): LiveCatalogItem | null {
  if (!row || typeof row !== "object") return null
  const record = row as {
    id?: unknown
    title?: unknown
    slug?: unknown
    price?: unknown
    isReserved?: unknown
    reserved?: unknown
  }
  if (typeof record.slug !== "string" || typeof record.title !== "string") return null
  const href = wallapopItemUrlOrNull(`https://es.wallapop.com/item/${record.slug}`)
  const price = cashAmount(record.price)
  if (!href || price == null) return null
  return {
    id: typeof record.id === "string" ? record.id : "",
    href,
    title: record.title,
    price,
    priceText: priceTextFromAmount(price),
    reserved: isReservedRecord(record),
  }
}

export function parseSellerItemsPayload(body: unknown): {
  items: LiveCatalogItem[]
  next: string | null
} {
  if (!body || typeof body !== "object") return { items: [], next: null }
  const record = body as { data?: unknown; meta?: { next?: unknown } }
  const items = Array.isArray(record.data)
    ? record.data.flatMap((row) => {
        const item = itemFromRecord(row)
        return item ? [item] : []
      })
    : []
  const next =
    typeof record.meta?.next === "string" && record.meta.next
      ? record.meta.next
      : null
  return { items, next }
}

export function sellerUserIdFromItemHtml(html: string): string | null {
  const match = html.match(/"userId":"([a-z0-9]+)"/i)
  return match?.[1] ?? null
}

export async function fetchSellerPublishedItems(
  userId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LiveCatalogItem[]> {
  const items: LiveCatalogItem[] = []
  let since: string | null = null
  for (let page = 0; page < PAGE_CAP; page += 1) {
    const url = new URL(
      `https://api.wallapop.com/api/v3/users/${encodeURIComponent(userId)}/items`,
    )
    if (since) url.searchParams.set("since", since)
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "X-DeviceOS": "0",
        "User-Agent": "Mozilla/5.0",
      },
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) {
      throw new Error(`seller items ${response.status}`)
    }
    const parsed = parseSellerItemsPayload(await response.json())
    items.push(...parsed.items)
    if (!parsed.next) return items
    since = parsed.next
  }
  throw new Error("seller items page cap")
}
