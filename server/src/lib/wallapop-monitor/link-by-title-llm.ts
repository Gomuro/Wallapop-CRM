import { wallapopItemUrlOrNull } from "../../../../lib/inventory/wallapop-item-url"
import { groqChatJson } from "../groq-chat-json"
import { parseCatalogPriceEur } from "../wallapop-publish/catalog-url"
import {
  foldTitleKey,
  listingMayBeOnWallapop,
  planTitleUrlLinks,
  rankCatalogCardsForListing,
  scoreListingCatalogCard,
  slugTitleFromHref,
  type CatalogTitleCard,
  type CrmTitleListing,
  type TitleUrlLink,
  type TitleUrlSkip,
} from "./link-by-title"

export type CrmLinkListing = CrmTitleListing & {
  priceEur: number | null
}

export type CombinedLink = TitleUrlLink & {
  source: "deterministic" | "llm"
  reason?: string
}

export type LlmLinkPlan = {
  links: CombinedLink[]
  skips: TitleUrlSkip[]
  llmCalls: number
}

const GROQ_SYSTEM = `Eres un clasificador para enlazar anuncios del CRM con filas del catálogo Wallapop del mismo vendedor.
Responde solo JSON válido con las claves: match (boolean), candidateIndex (number o null), confidence ("high" o "low"), reason (string breve en español).
match true solo si un candidato es claramente el mismo producto físico que el anuncio CRM.
Wallapop a veces reordena palabras o usa títulos más cortos generados por IA.
Si hay duda, dos candidatos plausibles, o ninguno encaja: match false y confidence low.
Solo confidence high cuando estás seguro. candidateIndex es el índice 0-based de la lista de candidatos.`

export type LlmPick = {
  match: boolean
  candidateIndex: number | null
  confidence: "high" | "low"
  reason: string
}

export function parseLlmPick(raw: Record<string, unknown>): LlmPick {
  const match = raw.match === true
  const confidence = raw.confidence === "high" ? "high" : "low"
  let candidateIndex: number | null = null
  if (typeof raw.candidateIndex === "number" && Number.isInteger(raw.candidateIndex)) {
    candidateIndex = raw.candidateIndex
  }
  const reason =
    typeof raw.reason === "string" ? raw.reason.trim() : "sin razón"
  return { match, candidateIndex, confidence, reason }
}

function normalizeHref(href: string): string | null {
  return wallapopItemUrlOrNull(href)
}

function uniqueCatalogCards(cards: CatalogTitleCard[]): CatalogTitleCard[] {
  const unique: CatalogTitleCard[] = []
  const seenHref = new Set<string>()
  for (const card of cards) {
    const href = normalizeHref(card.href)
    if (!href) continue
    if (seenHref.has(href)) continue
    seenHref.add(href)
    unique.push({ ...card, href })
  }
  return unique
}

function groupListingsByTitle<T extends { title: string }>(
  rows: T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const key = foldTitleKey(row.title)
    if (!key) continue
    const list = map.get(key)
    if (list) list.push(row)
    else map.set(key, [row])
  }
  return map
}

function buildLlmPrompt(
  row: CrmLinkListing,
  shortlist: CatalogTitleCard[],
): string {
  const lines = shortlist.map((card, index) => {
    const slug = slugTitleFromHref(card.href)
    const parsed = parseCatalogPriceEur(card.priceText ?? "")
    const price =
      card.priceText?.trim() ||
      (parsed != null ? `${parsed} EUR` : "")
    return `${index}: título="${card.title}" | precio="${price || "?"}" | slug="${slug}" | url=${card.href}`
  })
  const price =
    row.priceEur != null && Number.isFinite(row.priceEur)
      ? `${row.priceEur} EUR`
      : "desconocido"
  return [
    "Anuncio CRM:",
    `SKU: ${row.sku}`,
    `Título: ${row.title}`,
    `Precio: ${price}`,
    "",
    "Candidatos del catálogo Wallapop (elige uno o ninguno):",
    ...lines,
  ].join("\n")
}

async function askGroqForLink(
  row: CrmLinkListing,
  shortlist: CatalogTitleCard[],
): Promise<LlmPick> {
  const raw = await groqChatJson(GROQ_SYSTEM, buildLlmPrompt(row, shortlist))
  return parseLlmPick(raw)
}

export type PlanLlmOptions = {
  /** Delay between Groq calls (rate limits). */
  delayMs?: number
  shortlistSize?: number
  /** Inject for tests. */
  ask?: typeof askGroqForLink
}

export async function planCombinedTitleUrlLinks(
  listings: CrmLinkListing[],
  cards: CatalogTitleCard[],
  opts: PlanLlmOptions = {},
): Promise<LlmLinkPlan> {
  const delayMs = opts.delayMs ?? 400
  const shortlistSize = opts.shortlistSize ?? 8
  const ask = opts.ask ?? askGroqForLink

  const det = planTitleUrlLinks(listings, cards)
  const links: CombinedLink[] = det.links.map((link) => ({
    ...link,
    source: "deterministic",
  }))
  const usedHrefs = new Set(
    links.map((link) => normalizeHref(link.href)).filter(Boolean) as string[],
  )
  const linkedIds = new Set(links.map((link) => link.listingId))

  const pool = listings.filter(
    (row) =>
      listingMayBeOnWallapop(row.status) &&
      normalizeHref(row.externalUrl ?? "") == null &&
      !linkedIds.has(row.listingId),
  )
  const byTitle = groupListingsByTitle(pool)
  const llmRows = pool.filter(
    (row) => (byTitle.get(foldTitleKey(row.title)) ?? []).length === 1,
  )
  const llmSkuSet = new Set(llmRows.map((row) => row.sku))

  const skips: TitleUrlSkip[] = det.skips.filter(
    (skip) =>
      skip.reason !== "no_match" || !skip.sku || !llmSkuSet.has(skip.sku),
  )
  const skipKeys = new Set(
    skips.map(
      (skip) => `${skip.reason}:${skip.sku ?? ""}:${foldTitleKey(skip.title)}`,
    ),
  )
  const pushSkip = (skip: TitleUrlSkip) => {
    const key = `${skip.reason}:${skip.sku ?? ""}:${foldTitleKey(skip.title)}`
    if (skipKeys.has(key)) return
    skipKeys.add(key)
    skips.push(skip)
  }

  let available = uniqueCatalogCards(cards).filter((card) => {
    const href = normalizeHref(card.href)
    return href && !usedHrefs.has(href)
  })

  const llmQueue = [...llmRows].sort((a, b) => {
    const maxA = available.reduce(
      (best, card) => Math.max(best, scoreListingCatalogCard(a.title, card)),
      0,
    )
    const maxB = available.reduce(
      (best, card) => Math.max(best, scoreListingCatalogCard(b.title, card)),
      0,
    )
    return maxB - maxA
  })

  let llmCalls = 0
  for (const row of llmQueue) {
    if (linkedIds.has(row.listingId)) continue
    const shortlist = rankCatalogCardsForListing(
      row.title,
      available,
      shortlistSize,
    )
    if (shortlist.length === 0) {
      pushSkip({
        reason: "no_match",
        title: row.title,
        sku: row.sku,
      })
      continue
    }

    llmCalls += 1
    const pick = await ask(row, shortlist)
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }

    if (
      !pick.match ||
      pick.confidence !== "high" ||
      pick.candidateIndex == null ||
      pick.candidateIndex < 0 ||
      pick.candidateIndex >= shortlist.length
    ) {
      pushSkip({
        reason: "no_match",
        title: row.title,
        sku: row.sku,
      })
      continue
    }

    const card = shortlist[pick.candidateIndex]
    const href = normalizeHref(card.href)
    if (!href || usedHrefs.has(href)) {
      pushSkip({
        reason: "no_match",
        title: row.title,
        sku: row.sku,
      })
      continue
    }

    usedHrefs.add(href)
    linkedIds.add(row.listingId)
    available = available.filter((c) => normalizeHref(c.href) !== href)
    links.push({
      listingId: row.listingId,
      sku: row.sku,
      title: row.title,
      href,
      source: "llm",
      reason: pick.reason,
    })
  }

  return { links, skips, llmCalls }
}
