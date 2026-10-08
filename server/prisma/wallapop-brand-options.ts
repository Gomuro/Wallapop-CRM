export const BRAND_OPTIONS_URL =
  "https://api.wallapop.com/api/v3/attributes/brand/options"

export const BRAND_AUTH_PROBE_LEAF = 9839

export type WallapopBrandOption = {
  id: string
  title: string
}

export type WallapopBrandCatalog = {
  fingerprint: string
  brands: WallapopBrandOption[]
  leafWallapopIds: number[]
}

export type WallapopBrandsSnapshot = {
  fetchedAt: string
  catalogs: WallapopBrandCatalog[]
}

export type BrandHttp = {
  getJson: (url: string) => Promise<unknown>
}

export function wallapopSessionHeaders(bearer?: string): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json, text/plain, */*",
    "accept-language": "es",
    deviceos: "0",
    "x-appversion": "828990",
    "x-deviceos": "0",
    Referer: "https://es.wallapop.com/",
  }
  if (bearer) headers.authorization = `Bearer ${bearer}`
  return headers
}

export function fingerprintBrandPage(rows: WallapopBrandOption[]): string {
  return rows
    .slice(0, 20)
    .map((row) => row.id)
    .join("|")
}

export function parseBrandOptionsPayload(payload: unknown): {
  results: WallapopBrandOption[]
  nextToken: string | null
} {
  if (!payload || typeof payload !== "object") {
    return { results: [], nextToken: null }
  }
  const record = payload as { results?: unknown; token?: unknown }
  const raw = Array.isArray(record.results) ? record.results : []
  const results: WallapopBrandOption[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const row = item as { id?: unknown; title?: unknown }
    const id = typeof row.id === "string" ? row.id.trim() : ""
    const title =
      typeof row.title === "string" && row.title.trim()
        ? row.title.trim()
        : id
    if (id) results.push({ id, title })
  }
  const token =
    record.token === undefined || record.token === null
      ? null
      : String(record.token)
  return { results, nextToken: token && results.length > 0 ? token : null }
}

export async function fetchBrandOptionsPage(
  http: BrandHttp,
  leafWallapopId: number,
  cursor?: string,
): Promise<{ results: WallapopBrandOption[]; nextToken: string | null }> {
  const url = new URL(BRAND_OPTIONS_URL)
  url.searchParams.set("category_leaf_id", String(leafWallapopId))
  if (cursor) url.searchParams.set("token", cursor)
  return parseBrandOptionsPayload(await http.getJson(url.toString()))
}

export async function fetchAllBrandOptionsForLeaf(
  http: BrandHttp,
  leafWallapopId: number,
): Promise<WallapopBrandOption[]> {
  const all: WallapopBrandOption[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  for (let page = 0; page < 80; page += 1) {
    const { results, nextToken } = await fetchBrandOptionsPage(
      http,
      leafWallapopId,
      cursor,
    )
    for (const row of results) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      all.push(row)
    }
    if (!nextToken) break
    cursor = nextToken
  }
  return all
}
