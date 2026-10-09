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

/** Catalog list ellipsizes titles; require this many chars before a prefix match. */
const MIN_PARTIAL_CHARS = 12

export function normalizeCatalogTitle(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim()
}

export function foldTitleKey(value: string): string {
  return normalizeCatalogTitle(value)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
}

function catalogPrefix(title: string): string {
  return foldTitleKey(title).replace(/[.…]+$/u, "").trim()
}

/** CRM full title vs catalog card (often "Tapa Asiento WC Cuadrado B..."). */
export function titlesLooselyMatch(crmTitle: string, catalogTitle: string): boolean {
  const crm = foldTitleKey(crmTitle)
  const cat = catalogPrefix(catalogTitle)
  if (!crm || !cat) return false
  if (crm === cat) return true
  if (crm.startsWith(cat)) return cat.length >= MIN_PARTIAL_CHARS
  if (cat.startsWith(crm)) return crm.length >= MIN_PARTIAL_CHARS
  return false
}

function groupByTitle<T>(
  rows: T[],
  titleOf: (row: T) => string,
): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const key = foldTitleKey(titleOf(row))
    if (!key) continue
    const list = map.get(key)
    if (list) list.push(row)
    else map.set(key, [row])
  }
  return map
}

/**
 * Unique CRM listing ↔ unique catalog card.
 * Truncated card titles match as a prefix of the CRM title.
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
    if (!href || !catalogPrefix(card.title)) continue
    if (seenHref.has(href)) continue
    seenHref.add(href)
    uniqueCards.push({ href, title: card.title })
  }

  const links: TitleUrlLink[] = []
  const skips: TitleUrlSkip[] = []
  const claimed = new Map<string, CrmTitleListing[]>()

  for (const row of candidates) {
    const key = foldTitleKey(row.title)
    if (!key) {
      skips.push({ reason: "empty_title", title: row.title, sku: row.sku })
      continue
    }
    if ((byCrm.get(key) ?? []).length !== 1) {
      skips.push({ reason: "duplicate_crm", title: row.title, sku: row.sku })
      continue
    }
    const hits = uniqueCards.filter((card) =>
      titlesLooselyMatch(row.title, card.title),
    )
    if (hits.length === 0) {
      skips.push({ reason: "no_match", title: row.title, sku: row.sku })
      continue
    }
    if (hits.length !== 1) {
      skips.push({
        reason: "duplicate_catalog",
        title: row.title,
        sku: row.sku,
      })
      continue
    }
    const href = hits[0].href
    const owners = claimed.get(href) ?? []
    owners.push(row)
    claimed.set(href, owners)
  }

  for (const [href, owners] of claimed) {
    if (owners.length !== 1) {
      for (const row of owners) {
        skips.push({
          reason: "duplicate_catalog",
          title: row.title,
          sku: row.sku,
        })
      }
      continue
    }
    const row = owners[0]
    links.push({
      listingId: row.listingId,
      sku: row.sku,
      title: row.title,
      href,
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
    const aria = link
      ? String(link.getAttribute("aria-label") || "")
          .replace(/\\s+/g, " ")
          .trim()
      : ""
    if (aria.length > title.length) title = aria
    rows.push({
      href: link && link.href ? String(link.href) : "",
      title,
    })
  })
  return rows
})()`
