import type { ShippingPackageSize } from "@/lib/validations"

export const SHIPPING_PACKAGE_SIZE_OPTIONS: {
  value: ShippingPackageSize
  label: string
}[] = [
  { value: "STANDARD", label: "Estándar" },
  { value: "BULKY", label: "Voluminoso" },
]
