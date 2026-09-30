export const SHIPPING_NOT_READY_CODE = "SHIPPING_NOT_READY" as const

export const SHIPPING_NOT_READY_MESSAGE =
  "No se puede preparar el envío: indica peso y dimensiones (ancho, fondo, alto en cm)."

export const SHIPPING_INCOMPLETE_BADGE = "Faltan peso o medidas"

export type ShippingPublishField =
  | "weightKg"
  | "widthCm"
  | "lengthCm"
  | "heightCm"

export type ShippingPublishProductFields = {
  weightKg: number | null | undefined
  widthCm: number | null | undefined
  lengthCm: number | null | undefined
  heightCm: number | null | undefined
}

function isPositiveMeasure(value: number | null | undefined): boolean {
  return value != null && Number.isFinite(value) && value > 0
}

export function missingShippingPublishFields(
  product: ShippingPublishProductFields,
): ShippingPublishField[] {
  const missing: ShippingPublishField[] = []
  if (!isPositiveMeasure(product.weightKg)) missing.push("weightKg")
  if (!isPositiveMeasure(product.widthCm)) missing.push("widthCm")
  if (!isPositiveMeasure(product.lengthCm)) missing.push("lengthCm")
  if (!isPositiveMeasure(product.heightCm)) missing.push("heightCm")
  return missing
}

export function isShippingPublishReady(
  product: ShippingPublishProductFields,
): boolean {
  return missingShippingPublishFields(product).length === 0
}

export function validateShippingForPublish(
  product: ShippingPublishProductFields,
):
  | { ok: true }
  | { ok: false; code: typeof SHIPPING_NOT_READY_CODE; message: string } {
  if (isShippingPublishReady(product)) return { ok: true }
  return {
    ok: false,
    code: SHIPPING_NOT_READY_CODE,
    message: SHIPPING_NOT_READY_MESSAGE,
  }
}

/** Catalog badge: en venta product missing weight or dimensions (any listing state except POSTING). */
export function showShippingIncompleteBadge(product: {
  status: string
  listing?: { status: string; externalUrl?: string | null } | null
  listingActive?: boolean
  shippingPublishReady: boolean
}): boolean {
  if (product.shippingPublishReady) return false
  if (product.status !== "ACTIVE") return false
  if (product.listing?.status === "POSTING") return false
  return true
}
