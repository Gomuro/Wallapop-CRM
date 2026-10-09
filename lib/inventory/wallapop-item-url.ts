/** Public Wallapop item URL (`/item/…`). Upload / home do not count. */
export function wallapopItemUrlOrNull(
  url: string | null | undefined,
): string | null {
  if (url == null) return null
  const trimmed = url.trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    const host = parsed.hostname.toLowerCase()
    if (host !== "wallapop.com" && !host.endsWith(".wallapop.com")) return null
    if (/\/upload(\/|$)/i.test(parsed.pathname)) return null
    if (!/\/item\//i.test(parsed.pathname)) return null
    return parsed.href
  } catch {
    return null
  }
}

export function isWallapopItemUrl(url: string | null | undefined): boolean {
  return wallapopItemUrlOrNull(url) != null
}

/** `/item/<slug>` with a real listing slug (not bare `/item/` or site root). */
export function wallapopItemSlugHrefOrNull(
  url: string | null | undefined,
): string | null {
  const href = wallapopItemUrlOrNull(url)
  if (!href) return null
  try {
    const path = new URL(href).pathname
    if (!/\/item\/[^/]{8,}/i.test(path)) return null
    return href
  } catch {
    return null
  }
}

/** C8: public item URL on es.wallapop.com only. */
export function wallapopEsItemUrlOrNull(
  url: string | null | undefined,
): string | null {
  const href = wallapopItemUrlOrNull(url)
  if (!href) return null
  try {
    if (new URL(href).hostname.toLowerCase() !== "es.wallapop.com") return null
    return href
  } catch {
    return null
  }
}

/** Compare two /item/ URLs ignoring host/query (same listing). */
export function wallapopItemPathKey(
  url: string | null | undefined,
): string | null {
  const href = wallapopItemUrlOrNull(url)
  if (!href) return null
  try {
    return new URL(href).pathname.replace(/\/$/, "").toLowerCase()
  } catch {
    return null
  }
}

/** Prisma `ProductListing` filter: no public `/item/` URL (null or leftover junk). */
export const listingWithoutPublicItemUrlWhere = {
  OR: [
    { externalUrl: null },
    { NOT: { externalUrl: { contains: "/item/" } } },
  ],
}
