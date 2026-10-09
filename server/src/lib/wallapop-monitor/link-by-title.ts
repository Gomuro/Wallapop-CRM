import { wallapopItemUrlOrNull } from "../../../../lib/inventory/wallapop-item-url"

export type CatalogTitleCard = {
  href: string
  title: string
}

export type CrmTitleListing = {
  listingId: string
  sku: string
  title: string
  externalUrl: string | null
}

export type TitleUrlLink = {
  listingId: string
  sku: string
  title: string
  href: string
}

export type TitleUrlSkip = {
  reason: "empty_title" | "duplicate_crm" | "duplicate_catalog" | "no_match"
  title: string
  sku?: string
}

export type TitleUrlPlan = {
  links: TitleUrlLink[]
  skips: TitleUrlSkip[]
}

export function normalizeCatalogTitle(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim()
}

function groupByTitle<T>(
  rows: T[],
  titleOf: (row: T) => string,
): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const key = normalizeCatalogTitle(titleOf(row))
    if (!key) continue
    const list = map.get(key)
    if (list) list.push(row)
    else map.set(key, [row])
  }
  return map
}

/**
 * Exact title match only. Unique CRM title ↔ unique catalog card.
 * Does not set reserved/sold — only the public /item/ URL.
 */
export function planTitleUrlLinks(
  listings: CrmTitleListing[],
  cards: CatalogTitleCard[],
): TitleUrlPlan {
  const candidates = listings.filter(
    (row) => wallapopItemUrlOrNull(row.externalUrl) == null,
  )
  const byCrm = groupByTitle(candidates, (row) => row.title)
  const uniqueCards: CatalogTitleCard[] = []
  const seenHref = new Set<string>()
  for (const card of cards) {
    const href = wallapopItemUrlOrNull(card.href)
    const title = normalizeCatalogTitle(card.title)
    if (!href || !title) continue
    if (seenHref.has(href)) continue
    seenHref.add(href)
    uniqueCards.push({ href, title: card.title })
  }
  const byCatalog = groupByTitle(uniqueCards, (row) => row.title)

  const links: TitleUrlLink[] = []
  const skips: TitleUrlSkip[] = []

  for (const row of candidates) {
    const key = normalizeCatalogTitle(row.title)
    if (!key) {
      skips.push({ reason: "empty_title", title: row.title, sku: row.sku })
      continue
    }
    const crmHits = byCrm.get(key) ?? []
    if (crmHits.length !== 1) {
      skips.push({ reason: "duplicate_crm", title: row.title, sku: row.sku })
      continue
    }
    const catalogHits = byCatalog.get(key) ?? []
    if (catalogHits.length === 0) {
      skips.push({ reason: "no_match", title: row.title, sku: row.sku })
      continue
    }
    if (catalogHits.length !== 1) {
      skips.push({
        reason: "duplicate_catalog",
        title: row.title,
        sku: row.sku,
      })
      continue
    }
    links.push({
      listingId: row.listingId,
      sku: row.sku,
      title: row.title,
      href: catalogHits[0].href,
    })
  }

  return { links, skips }
}

export const CATALOG_TITLE_CARDS_EVAL = `(() => {
  function collect(root, into) {
    if (!root || !root.querySelectorAll) return
    root.querySelectorAll("*").forEach((el) => {
      into.push(el)
      if (el.shadowRoot) collect(el.shadowRoot, into)
    })
  }
  function classNameOf(el) {
    const raw = el.className
    return typeof raw === "string" ? raw : String(raw || "")
  }
  const rows = []
  document.querySelectorAll("tsl-catalog-item").forEach((host) => {
    const nodes = [host]
    collect(host, nodes)
    if (host.shadowRoot) collect(host.shadowRoot, nodes)
    const link = nodes.find(
      (n) =>
        n.tagName === "A" &&
        n.href &&
        String(n.href).includes("/item/"),
    )
    const titleNode = nodes.find((n) => {
      const cls = classNameOf(n)
      return /info-title|CatalogItem__title/i.test(cls)
    })
    let title = titleNode
      ? String(titleNode.textContent || "").replace(/\\s+/g, " ").trim()
      : ""
    if (!title && link) {
      title = String(link.getAttribute("aria-label") || "")
        .replace(/\\s+/g, " ")
        .trim()
    }
    rows.push({
      href: link && link.href ? String(link.href) : "",
      title,
    })
  })
  return rows
})()`
