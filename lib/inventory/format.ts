import type { ProductStatus } from "@/lib/validations"

export function formatEuro(amount: number) {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount)
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
