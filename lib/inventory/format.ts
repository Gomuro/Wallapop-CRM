import type { ListingStatus, ProductStatus } from "@/lib/validations"

export function formatEuro(amount: number) {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  })
    .format(amount)
    .replace(/[\u00A0\u202F]/g, "\u00A0")
}

export function statusLabel(status: ProductStatus) {
  switch (status) {
    case "ACTIVE":
      return "En venta"
    case "SOLD":
      return "Vendido"
    case "INACTIVE":
      return "Inactivo"
  }
}

export function listingStatusLabel(status: ListingStatus) {
  switch (status) {
    case "ACTIVE":
      return "En venta"
    case "DEACTIVATED":
      return "Desactivado"
    case "READY_TO_POST":
      return "Listo para publicar"
  }
}

const CATEGORY_LABELS: Record<string, string> = {
  Electronics: "Electrónica",
  Home: "Hogar",
  Fashion: "Moda",
  Sports: "Deporte",
  Toys: "Juguetes",
  Other: "Otros",
}

const CONDITION_LABELS: Record<string, string> = {
  New: "Nuevo",
  NEW: "Nuevo",
  "As good as new": "Como nuevo",
  AS_GOOD_AS_NEW: "Como nuevo",
  Good: "En buen estado",
  GOOD: "En buen estado",
  Fair: "Aceptable",
  FAIR: "Aceptable",
  "Has given it all": "Lo ha dado todo",
  HAS_GIVEN_IT_ALL: "Lo ha dado todo",
}

export function categoryLabel(value: string) {
  return CATEGORY_LABELS[value] ?? value
}

export function conditionLabel(value: string) {
  return CONDITION_LABELS[value] ?? value
}
