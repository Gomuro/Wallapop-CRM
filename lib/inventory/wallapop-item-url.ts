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

/** Prisma `ProductListing` filter: no public `/item/` URL (null or leftover junk). */
export const listingWithoutPublicItemUrlWhere = {
  OR: [
    { externalUrl: null },
    { NOT: { externalUrl: { contains: "/item/" } } },
  ],
}
