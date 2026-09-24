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
      return "Active"
    case "SOLD":
      return "Sold"
    case "INACTIVE":
      return "Inactive"
  }
}

export function listingStatusLabel(status: ListingStatus) {
  switch (status) {
    case "ACTIVE":
      return "Active"
    case "DEACTIVATED":
      return "Deactivated"
    case "READY_TO_POST":
      return "Ready to post"
  }
}
