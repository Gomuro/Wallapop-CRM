import type { ProductCondition } from "@/lib/validations"

const LABELS: Record<ProductCondition, string> = {
  NEW: "Nuevo",
  AS_GOOD_AS_NEW: "Como nuevo",
  GOOD: "En buen estado",
  FAIR: "Aceptable",
  HAS_GIVEN_IT_ALL: "Lo ha dado todo",
}

const ENGLISH_LABELS: Record<ProductCondition, string> = {
  NEW: "New",
  AS_GOOD_AS_NEW: "As good as new",
  GOOD: "Good",
  FAIR: "Fair",
  HAS_GIVEN_IT_ALL: "Has given it all",
}

const BY_LABEL = new Map<string, ProductCondition>()
for (const [code, label] of Object.entries(LABELS)) {
  BY_LABEL.set(label.toLowerCase(), code as ProductCondition)
}
for (const [code, label] of Object.entries(ENGLISH_LABELS)) {
  BY_LABEL.set(label.toLowerCase(), code as ProductCondition)
}

export const PRODUCT_CONDITION_OPTIONS: {
  value: ProductCondition
  label: string
}[] = (
  Object.entries(LABELS) as [ProductCondition, string][]
).map(([value, label]) => ({ value, label }))

export function conditionLabel(code: ProductCondition): string {
  return LABELS[code]
}

export function conditionFromLabel(label: string): ProductCondition | null {
  const code = BY_LABEL.get(label.trim().toLowerCase())
  return code ?? null
}

export function conditionFromFormValue(value: string): ProductCondition {
  if (value in LABELS) return value as ProductCondition
  const fromLabel = conditionFromLabel(value)
  if (fromLabel) return fromLabel
  return "GOOD"
}
