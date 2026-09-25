export const listingJsonSelect = {
  id: true,
  status: true,
  externalUrl: true,
  externalItemId: true,
  shippingEnabled: true,
  shippingUpToKg: true,
  accountId: true,
} as const

export function toListingJson(row: {
  id: string
  status: string
  externalUrl: string | null
  externalItemId: string | null
  shippingEnabled: boolean
  shippingUpToKg: number | null
  accountId: string
}) {
  return {
    id: row.id,
    status: row.status,
    externalUrl: row.externalUrl,
    externalItemId: row.externalItemId,
    shippingEnabled: row.shippingEnabled,
    shippingUpToKg: row.shippingUpToKg,
    accountId: row.accountId,
  }
}
