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

export const ITEM_PAGE_FACTS_EVAL = `(() => {
  function og(prop) {
    const el = document.querySelector('meta[property="' + prop + '"]')
    return el ? String(el.getAttribute("content") || "").trim() : ""
  }
  function named(name) {
    const el = document.querySelector('meta[name="' + name + '"]')
    return el ? String(el.getAttribute("content") || "").trim() : ""
  }
  let jsonTitle = ""
  let jsonDesc = ""
  let jsonPrice = ""
  document.querySelectorAll('script[type="application/ld+json"]').forEach((node) => {
    try {
      const parsed = JSON.parse(node.textContent || "")
      const nodes = Array.isArray(parsed) ? parsed : [parsed]
      for (const row of nodes) {
        if (!row || typeof row !== "object") continue
        const type = row["@type"]
        const isProduct =
          type === "Product" ||
          (Array.isArray(type) && type.includes("Product"))
        if (!isProduct) continue
        if (row.name) jsonTitle = String(row.name)
        if (row.description) jsonDesc = String(row.description)
        const offers = row.offers
        const offer = Array.isArray(offers) ? offers[0] : offers
        if (offer && offer.price != null) jsonPrice = String(offer.price)
      }
    } catch (e) {}
  })
  const h1 = document.querySelector("h1")
  const h1Text = h1
    ? String(h1.textContent || "").replace(/\\s+/g, " ").trim()
    : ""
  return {
    href: String(location.href || ""),
    title: jsonTitle || og("og:title") || h1Text,
    description: jsonDesc || og("og:description") || named("description"),
    priceText: jsonPrice || og("product:price:amount") || og("og:price:amount"),
  }
})()`

function normalizeHref(href: string): string | null {
  return wallapopItemSlugHrefOrNull(href)
}

function clip(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim()
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
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
  const bag = new Set([
    ...descTokens(listing.title),
    ...descTokens(listing.description),
  ])
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

/**
 * One Wallapop /item/ page → one CRM listing without a public URL.
 * Duplicate CRM titles stay in the pool (descriptions distinguish them).
 */
export async function planItemPageUrlLinks(
  listings: ItemPageCrmListing[],
  pages: ItemPageFacts[],
  opts: PlanItemPageOptions = {},
): Promise<ItemPageLinkPlan> {
  const delayMs = opts.delayMs ?? 400
  const shortlistSize = opts.shortlistSize ?? 8
  const ask = opts.ask ?? askGroqForItemPage

  const takenHrefs = new Set<string>()
  for (const row of listings) {
    const href = normalizeHref(row.externalUrl ?? "")
    if (href) takenHrefs.add(href)
  }

  const uniquePages: ItemPageFacts[] = []
  const seen = new Set<string>()
  let alreadyLinked = 0
  for (const page of pages) {
    const href = normalizeHref(page.href)
    if (!href) continue
    if (seen.has(href)) continue
    seen.add(href)
    if (takenHrefs.has(href)) {
      alreadyLinked += 1
      continue
    }
    uniquePages.push({ ...page, href })
  }

  const pool = listings.filter(
    (row) =>
      listingMayBeOnWallapop(row.status) &&
      normalizeHref(row.externalUrl ?? "") == null,
  )
  const linkedIds = new Set<string>()
  const links: CombinedLink[] = []
  const skips: TitleUrlSkip[] = []
  const skipKeys = new Set<string>()
  const pushSkip = (skip: TitleUrlSkip) => {
    const key = `${skip.reason}:${skip.sku ?? ""}:${foldTitleKey(skip.title)}`
    if (skipKeys.has(key)) return
    skipKeys.add(key)
    skips.push(skip)
  }

  let available = [...pool]
  let llmCalls = 0

  for (const facts of uniquePages) {
    if (!facts.title.trim() && !slugTitleFromHref(facts.href)) {
      pushSkip({ reason: "empty_title", title: facts.title || facts.href })
      continue
    }
    const shortlist = rankListingsForItemPage(
      facts,
      available.filter((row) => !linkedIds.has(row.listingId)),
      shortlistSize,
    )
    if (shortlist.length === 0) {
      pushSkip({ reason: "no_match", title: facts.title })
      continue
    }

    llmCalls += 1
    const pick = await ask(facts, shortlist)
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
      pushSkip({ reason: "no_match", title: facts.title })
      continue
    }

    const row = shortlist[pick.candidateIndex]
    if (linkedIds.has(row.listingId) || takenHrefs.has(facts.href)) {
      pushSkip({ reason: "duplicate_catalog", title: row.title, sku: row.sku })
      continue
    }

    linkedIds.add(row.listingId)
    takenHrefs.add(facts.href)
    available = available.filter((item) => item.listingId !== row.listingId)
    links.push({
      listingId: row.listingId,
      sku: row.sku,
      title: row.title,
      href: facts.href,
      source: "llm",
      reason: pick.reason,
    })
  }

  for (const row of pool) {
    if (linkedIds.has(row.listingId)) continue
    pushSkip({ reason: "no_match", title: row.title, sku: row.sku })
  }

  return { links, skips, llmCalls, alreadyLinked }
}
