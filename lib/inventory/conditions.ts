import type { ProductCondition } from "@/lib/validations"

const LABELS: Record<ProductCondition, string> = {
  NEW: "New",
  AS_GOOD_AS_NEW: "As good as new",
  GOOD: "Good",
  FAIR: "Fair",
  HAS_GIVEN_IT_ALL: "Has given it all",
}

const BY_LABEL = new Map(
  Object.entries(LABELS).map(([code, label]) => [label.toLowerCase(), code]),
)

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
  return (code as ProductCondition | undefined) ?? null
}

export function conditionFromFormValue(value: string): ProductCondition {
  if (value in LABELS) return value as ProductCondition
  const fromLabel = conditionFromLabel(value)
  if (fromLabel) return fromLabel
  return "GOOD"
}
