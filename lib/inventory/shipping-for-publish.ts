export const SHIPPING_NOT_READY_CODE = "SHIPPING_NOT_READY" as const

export const SHIPPING_NOT_READY_MESSAGE =
  "No se puede preparar el envío: indica el peso."

export const SHIPPING_INCOMPLETE_BADGE = "Falta peso"

export type ShippingPublishField = "weightKg"

export type ShippingPublishProductFields = {
  weightKg: number | null | undefined
  /** Pickup-only listings do not need peso for Wallapop envío. */
  shippingEnabled?: boolean
}

function isPositiveMeasure(value: number | null | undefined): boolean {
  return value != null && Number.isFinite(value) && value > 0
}

export function missingShippingPublishFields(
  product: ShippingPublishProductFields,
): ShippingPublishField[] {
  if (product.shippingEnabled === false) return []
  return isPositiveMeasure(product.weightKg) ? [] : ["weightKg"]
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

/** Catalog badge: en venta product missing weight (any listing state except POSTING). */
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
