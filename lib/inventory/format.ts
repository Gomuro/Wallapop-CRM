import type { ListingStatusRead } from "@/lib/inventory/types"
import type { ProductStatus } from "@/lib/validations"

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
    default:
      return "En venta"
  }
}

export function listingStatusLabel(status: ListingStatusRead) {
  switch (status) {
    case "ACTIVE":
      return "En venta"
    case "DEACTIVATED":
      return "Desactivado"
    case "READY_TO_POST":
      return "Listo para publicar"
    case "POSTING":
      return "Publicando…"
    case "FAILED":
      return "Error al publicar"
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

export function isListingActive(
  listing: { status: ListingStatusRead } | null | undefined,
  listingActive?: boolean,
) {
  if (listing?.status === "POSTING") return false
  if (listingActive === true) return true
  if (listingActive === false) return false
  return listing?.status === "ACTIVE"
}

/** Short label for catalog card badge (single default listing). */
export function listingIndicatorShort(
  listing: { status: ListingStatusRead } | null | undefined,
  listingActive?: boolean,
): string | null {
  if (!listing) return null
  if (listing.status === "POSTING") return "Publicando…"
  if (listing.status === "FAILED") return "Error al publicar"
  if (isListingActive(listing, listingActive)) return "En Wallapop"
  if (listing.status === "READY_TO_POST") return "Listo para publicar"
  if (listing.status === "DEACTIVATED") return "Desactivado"
  return listingStatusLabel(listing.status)
}

export function listingBadgeVariant(
  listing: { status: ListingStatusRead } | null | undefined,
  listingActive?: boolean,
): "default" | "outline" | "secondary" {
  if (listing?.status === "POSTING") return "outline"
  if (isListingActive(listing, listingActive)) return "default"
  if (listing?.status === "READY_TO_POST") return "secondary"
  return "outline"
}

export function formatListingPostedAt(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

/** Human countdown for autopost next tick (Spanish, compact). */
export function formatAutopostCountdown(remainingMs: number): string {
  const totalSec = Math.max(0, Math.ceil(remainingMs / 1000))
  if (totalSec <= 0) return "En breve…"

  const days = Math.floor(totalSec / 86400)
  const hours = Math.floor((totalSec % 86400) / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60

  if (days > 0) {
    return hours > 0 ? `${days} d ${hours} h` : `${days} d`
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`
  }
  return `${seconds} s`
}

export function apiErrorMessage(code: string, fallback: string) {
  switch (code) {
    case "VALIDATION_ERROR":
      return fallback
    case "NOT_FOUND":
      return fallback
    case "PUBLISH_IN_PROGRESS":
      return "Se está publicando. Márcalo como publicado o espera a que termine."
    case "SHIPPING_NOT_READY":
      return fallback
    default:
      return fallback
  }
}
