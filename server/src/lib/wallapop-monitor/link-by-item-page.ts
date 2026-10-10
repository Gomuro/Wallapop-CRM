import { wallapopItemSlugHrefOrNull } from "../../../../lib/inventory/wallapop-item-url"
import { groqChatJson } from "../groq-chat-json"
import { parseCatalogPriceEur } from "../wallapop-publish/catalog-url"
import {
  parseLlmPick,
  type CombinedLink,
  type CrmLinkListing,
  type LlmPick,
} from "./link-by-title-llm"
import {
  foldTitleKey,
  listingMayBeOnWallapop,
  scoreListingCatalogCard,
  slugTitleFromHref,
  type TitleUrlSkip,
} from "./link-by-title"

export type ItemPageFacts = {
  href: string
  title: string
  description: string
  priceText: string
}

export type ItemPageCrmListing = CrmLinkListing & {
  description: string
}
export type ItemPageLinkPlan = {
  links: CombinedLink[]
  skips: TitleUrlSkip[]
  llmCalls: number
  alreadyLinked: number
}

const DESC_PROMPT_CHARS = 1_200

const GROQ_SYSTEM = `Eres un clasificador para enlazar una ficha pública Wallapop (/item/) con un producto del CRM del mismo vendedor.
Responde solo JSON válido con las claves: match (boolean), candidateIndex (number o null), confidence ("high" o "low"), reason (string breve en español).
Usa título, descripción y precio. Wallapop a menudo reescribe el título con IA; la descripción del CRM suele coincidir más.
match true solo si un candidato es el mismo producto físico.
Si hay duda, dos candidatos plausibles, o ninguno encaja: match false y confidence low.
Solo confidence high cuando estás seguro. candidateIndex es el índice 0-based de la lista de candidatos.`

function normalizeHref(href: string): string | null {
  return wallapopItemSlugHrefOrNull(href)
}

function clip(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim()
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

function descTokens(value: string): string[] {
  return foldTitleKey(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3)
}

export function scoreItemPageToListing(
  listing: ItemPageCrmListing,
  facts: ItemPageFacts,
): number {
  let score = scoreListingCatalogCard(listing.title, {
    href: facts.href,
    title: facts.title,
  })
  const bag = new Set([...descTokens(listing.title), ...descTokens(listing.description)])
  for (const token of descTokens(facts.description)) {
    if (bag.has(token)) score += 4
  }
  for (const token of descTokens(facts.title)) {
    if (bag.has(token)) score += 2
  }
  const itemPrice = parseCatalogPriceEur(facts.priceText)
  if (
    itemPrice != null &&
    listing.priceEur != null &&
    Number.isFinite(listing.priceEur) &&
    Math.abs(itemPrice - listing.priceEur) < 0.05
  ) {
    score += 15
  }
  return score
}

export function rankListingsForItemPage(
  facts: ItemPageFacts,
  listings: ItemPageCrmListing[],
  limit = 8,
): ItemPageCrmListing[] {
  return listings
    .map((listing) => ({
      listing,
      score: scoreItemPageToListing(listing, facts),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => row.listing)
}

function buildPrompt(
  facts: ItemPageFacts,
  shortlist: ItemPageCrmListing[],
): string {
  const slug = slugTitleFromHref(facts.href)
  const itemPrice =
    facts.priceText.trim() ||
    (parseCatalogPriceEur(facts.priceText) != null
      ? `${parseCatalogPriceEur(facts.priceText)} EUR`
      : "?")
  const candidates = shortlist.map((row, index) => {
    const price =
      row.priceEur != null && Number.isFinite(row.priceEur)
        ? `${row.priceEur} EUR`
        : "?"
    return [
      `${index}: SKU ${row.sku}`,
      `título="${row.title}"`,
      `precio="${price}"`,
      `descripción="${clip(row.description, DESC_PROMPT_CHARS)}"`,
    ].join(" | ")
  })
  return [
    "Ficha Wallapop (página del anuncio):",
    `URL: ${facts.href}`,
    `Título: ${facts.title}`,
    `Precio: ${itemPrice}`,
    `Slug: ${slug}`,
    `Descripción: ${clip(facts.description, DESC_PROMPT_CHARS)}`,
    "",
    "Candidatos CRM (elige uno o ninguno):",
    ...candidates,
  ].join("\n")
}

async function askGroqForItemPage(
  facts: ItemPageFacts,
  shortlist: ItemPageCrmListing[],
): Promise<LlmPick> {
  const raw = await groqChatJson(GROQ_SYSTEM, buildPrompt(facts, shortlist))
  return parseLlmPick(raw)
}

export type PlanItemPageOptions = {
  delayMs?: number
  shortlistSize?: number
  ask?: (
    facts: ItemPageFacts,
    shortlist: ItemPageCrmListing[],
  ) => Promise<LlmPick>
}

function takenItemHrefs(listings: ItemPageCrmListing[]) {
  const takenHrefs = new Set<string>()
  for (const row of listings) {
    const href = normalizeHref(row.externalUrl ?? "")
    if (href) takenHrefs.add(href)
  }
  return takenHrefs
}

function uniqueUnlinkedPages(
  pages: ItemPageFacts[],
  takenHrefs: Set<string>,
) {
  const uniquePages: ItemPageFacts[] = []
  const seen = new Set<string>()
  let alreadyLinked = 0
  for (const page of pages) {
    const href = normalizeHref(page.href)
    if (!href || seen.has(href)) continue
    seen.add(href)
    if (takenHrefs.has(href)) {
      alreadyLinked += 1
      continue
    }
    uniquePages.push({ ...page, href })
  }
  return { uniquePages, alreadyLinked }
}

function isHighConfidencePick(
  pick: LlmPick,
  shortlistLength: number,
): pick is LlmPick & { candidateIndex: number } {
  return (
    pick.match &&
    pick.confidence === "high" &&
    pick.candidateIndex != null &&
    pick.candidateIndex >= 0 &&
    pick.candidateIndex < shortlistLength
  )
}

function llmLinkFromListing(
  row: ItemPageCrmListing,
  href: string,
  reason: string,
): CombinedLink {
  return {
    listingId: row.listingId,
    sku: row.sku,
    title: row.title,
    href,
    source: "llm",
    reason,
  }
}

async function delayMsIfNeeded(delayMs: number) {
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
}

async function linkOneItemPage(ctx: {
  facts: ItemPageFacts
  available: ItemPageCrmListing[]
  linkedIds: Set<string>
  takenHrefs: Set<string>
  shortlistSize: number
  delayMs: number
  ask: NonNullable<PlanItemPageOptions["ask"]>
  pushSkip: (skip: TitleUrlSkip) => void
}): Promise<{ link: CombinedLink | null; calledLlm: boolean }> {
  const { facts } = ctx
  if (!facts.title.trim() && !slugTitleFromHref(facts.href)) {
    ctx.pushSkip({ reason: "empty_title", title: facts.title || facts.href })
    return { link: null, calledLlm: false }
  }
  const shortlist = rankListingsForItemPage(
    facts,
    ctx.available.filter((row) => !ctx.linkedIds.has(row.listingId)),
    ctx.shortlistSize,
  )
  if (shortlist.length === 0) {
    ctx.pushSkip({ reason: "no_match", title: facts.title })
    return { link: null, calledLlm: false }
  }
  const pick = await ctx.ask(facts, shortlist)
  await delayMsIfNeeded(ctx.delayMs)
  if (!isHighConfidencePick(pick, shortlist.length)) {
    ctx.pushSkip({ reason: "no_match", title: facts.title })
    return { link: null, calledLlm: true }
  }
  const row = shortlist[pick.candidateIndex]
  if (ctx.linkedIds.has(row.listingId) || ctx.takenHrefs.has(facts.href)) {
    ctx.pushSkip({ reason: "duplicate_catalog", title: row.title, sku: row.sku })
    return { link: null, calledLlm: true }
  }
  return { calledLlm: true, link: llmLinkFromListing(row, facts.href, pick.reason) }
}

function createSkipBag() {
  const skips: TitleUrlSkip[] = []
  const skipKeys = new Set<string>()
  const pushSkip = (skip: TitleUrlSkip) => {
    const key = `${skip.reason}:${skip.sku ?? ""}:${foldTitleKey(skip.title)}`
    if (skipKeys.has(key)) return
    skipKeys.add(key)
    skips.push(skip)
  }
  return { skips, pushSkip }
}

function listingsNeedingUrl(listings: ItemPageCrmListing[]) {
  return listings.filter(
    (row) =>
      listingMayBeOnWallapop(row.status) &&
      normalizeHref(row.externalUrl ?? "") == null,
  )
}

async function linkUniqueItemPages(ctx: {
  uniquePages: ItemPageFacts[]
  pool: ItemPageCrmListing[]
  takenHrefs: Set<string>
  shortlistSize: number
  delayMs: number
  ask: NonNullable<PlanItemPageOptions["ask"]>
  pushSkip: (skip: TitleUrlSkip) => void
}) {
  const linkedIds = new Set<string>()
  const links: CombinedLink[] = []
  let available = [...ctx.pool]
  let llmCalls = 0
  for (const facts of ctx.uniquePages) {
    const result = await linkOneItemPage({ ...ctx, facts, available, linkedIds })
    if (result.calledLlm) llmCalls += 1
    if (!result.link) continue
    linkedIds.add(result.link.listingId)
    ctx.takenHrefs.add(result.link.href)
    available = available.filter((item) => item.listingId !== result.link!.listingId)
    links.push(result.link)
  }
  return { linkedIds, links, llmCalls }
}

/**
 * One Wallapop /item/ page → one CRM listing without a public URL.
 * Duplicate CRM titles stay in the pool (descriptions distinguish them).
 */
export async function planItemPageUrlLinks(
  listings: ItemPageCrmListing[],
  pages: ItemPageFacts[],
  opts: PlanItemPageOptions = {},
): Promise<ItemPageLinkPlan> {
  const takenHrefs = takenItemHrefs(listings)
  const { uniquePages, alreadyLinked } = uniqueUnlinkedPages(pages, takenHrefs)
  const pool = listingsNeedingUrl(listings)
  const { skips, pushSkip } = createSkipBag()
  const linked = await linkUniqueItemPages({
    uniquePages,
    pool,
    takenHrefs,
    shortlistSize: opts.shortlistSize ?? 8,
    delayMs: opts.delayMs ?? 400,
    ask: opts.ask ?? askGroqForItemPage,
    pushSkip,
  })
  for (const row of pool) {
    if (!linked.linkedIds.has(row.listingId)) {
      pushSkip({ reason: "no_match", title: row.title, sku: row.sku })
    }
  }
  return { links: linked.links, skips, llmCalls: linked.llmCalls, alreadyLinked }
}
