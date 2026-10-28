/**
 * Checks an AI rewrite of a product ad before it may be used for a duplicate.
 * Facts must survive (every number, the brand), wording must change, and the
 * title must fit Wallapop's 50 characters. Messages are for the CRM operator.
 */
export const VARIANT_TITLE_MAX = 50
const DESCRIPTION_MIN_RATIO = 0.6
const DESCRIPTION_MAX_RATIO = 1.5
/** A short comma list grows when it is rewritten as sentences. */
const SHORT_DESCRIPTION = 300
const SHORT_DESCRIPTION_MAX_RATIO = 2
const MAX_WORD_OVERLAP = 0.9
const SPANISH_HINTS = /\b(de|la|el|los|las|para|con|en|y|del|muy|sin)\b/i

export type VariantSource = {
  title: string
  description: string
  brand: string | null
}

export type VariantText = {
  title: string
  description: string
}

/** "1,2 x 2,40m" -> ["1.2", "2.4"]. Numbers are the facts we must not lose or invent. */
export function factNumbers(text: string): Set<string> {
  const found = new Set<string>()
  for (const match of text.matchAll(/\d+(?:[.,]\d+)?/g)) {
    found.add(String(Number(match[0].replace(",", "."))))
  }
  return found
}

function words(text: string): Set<string> {
  const out = new Set<string>()
  for (const word of text.toLowerCase().match(/\p{L}{3,}/gu) ?? []) out.add(word)
  return out
}

function overlap(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const word of left) if (right.has(word)) shared += 1
  return shared / new Set([...left, ...right]).size
}

function sameText(left: string, right: string): boolean {
  const norm = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim()
  return norm(left) === norm(right)
}

function titleProblems(source: VariantSource, text: VariantText): string[] {
  const title = text.title.trim()
  if (!title) return ["El título está vacío."]
  const problems: string[] = []
  if (title.length > VARIANT_TITLE_MAX) {
    problems.push(`El título tiene ${title.length} caracteres (máximo ${VARIANT_TITLE_MAX}).`)
  }
  if (sameText(title, source.title)) problems.push("El título es igual al original.")
  const allowed = factNumbers(`${source.title} ${source.description}`)
  const invented = [...factNumbers(title)].filter((n) => !allowed.has(n))
  if (invented.length) problems.push(`El título añade cifras: ${invented.join(", ")}.`)
  return problems
}

function descriptionLengthProblem(source: VariantSource, description: string): string | null {
  const original = source.description.trim().length
  if (original < 40) return null
  const ratio = description.length / original
  const maxRatio = original < SHORT_DESCRIPTION ? SHORT_DESCRIPTION_MAX_RATIO : DESCRIPTION_MAX_RATIO
  if (ratio < DESCRIPTION_MIN_RATIO) return "La descripción es demasiado corta frente al original."
  if (ratio > maxRatio) return "La descripción es demasiado larga frente al original."
  return null
}

function descriptionProblems(source: VariantSource, text: VariantText): string[] {
  const description = text.description.trim()
  if (!description) return ["La descripción está vacía."]
  const problems: string[] = []
  if (sameText(description, source.description)) {
    problems.push("La descripción es igual a la original.")
  } else if (overlap(words(description), words(source.description)) >= MAX_WORD_OVERLAP) {
    problems.push("La descripción repite casi las mismas palabras que la original.")
  }
  const lengthProblem = descriptionLengthProblem(source, description)
  if (lengthProblem) problems.push(lengthProblem)
  if (description.length > 60 && !SPANISH_HINTS.test(description)) {
    problems.push("La descripción no parece estar en español.")
  }
  return problems
}

function factProblems(source: VariantSource, text: VariantText): string[] {
  const problems: string[] = []
  const before = factNumbers(`${source.title} ${source.description}`)
  const after = factNumbers(`${text.title} ${text.description}`)
  const lost = [...before].filter((n) => !after.has(n))
  const added = [...after].filter((n) => !before.has(n))
  if (lost.length) problems.push(`Faltan cifras del original: ${lost.join(", ")}.`)
  if (added.length) problems.push(`Aparecen cifras que no están en el original: ${added.join(", ")}.`)
  const brand = source.brand?.trim()
  const original = plain(`${source.title} ${source.description}`)
  if (brand && original.includes(plain(brand))) {
    const rewritten = plain(`${text.title} ${text.description}`)
    if (!rewritten.includes(plain(brand))) problems.push(`Falta la marca ${brand}.`)
  }
  return problems
}

/** Brand "Jane" vs text "Jané": compare without case or accents. */
function plain(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
}

/** Condition warnings a buyer must still see: "sin caja", "faltan piezas", "abolladura", "montada". */
const CONDITION_MARKS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bfaltan?\b/u, label: "falta / faltan" },
  { pattern: /\babolladura/u, label: "abolladura" },
  { pattern: /\bgolpe/u, label: "golpe" },
  { pattern: /\brayad[oa]s?\b|\barañazo/u, label: "rayado" },
  { pattern: /\brot[oa]s?\b/u, label: "roto" },
  { pattern: /\bdefect|\bdesperfect/u, label: "defecto" },
  { pattern: /\bmontad[oa]s?\b/u, label: "montado" },
]

/** "Sin caja!", "sin filtro", "sin accesorios": every "sin <word>" of the original. */
function sinPhrases(text: string): Set<string> {
  return new Set([...text.matchAll(/\bsin\s+(\p{L}{3,})/gu)].map((match) => `sin ${match[1]}`))
}

export function conditionProblems(source: VariantSource, text: VariantText): string[] {
  const before = plain(`${source.title} ${source.description}`)
  const after = plain(`${text.title} ${text.description}`)
  const missing = [...sinPhrases(before)].filter((phrase) => !after.includes(phrase))
  for (const mark of CONDITION_MARKS) {
    if (mark.pattern.test(before) && !mark.pattern.test(after)) missing.push(mark.label)
  }
  if (!missing.length) return []
  return [`Falta el aviso sobre el estado del original: ${missing.map((m) => `«${m}»`).join(", ")}.`]
}

/** Empty list = the rewrite can be used. */
export function variantProblems(source: VariantSource, text: VariantText): string[] {
  return [
    ...titleProblems(source, text),
    ...descriptionProblems(source, text),
    ...factProblems(source, text),
    ...conditionProblems(source, text),
  ]
}
