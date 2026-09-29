export const listingJsonSelect = {
  id: true,
  status: true,
  externalUrl: true,
  externalItemId: true,
  shippingEnabled: true,
  shippingUpToKg: true,
  accountId: true,
  lastPostedAt: true,
} as const

export function toListingJson(row: {
  id: string
  status: string
  externalUrl: string | null
  externalItemId: string | null
  shippingEnabled: boolean
  shippingUpToKg: number | null
  accountId: string
  lastPostedAt: Date | null
}) {
  return {
    id: row.id,
    status: row.status,
    externalUrl: row.externalUrl,
    externalItemId: row.externalItemId,
    shippingEnabled: row.shippingEnabled,
    shippingUpToKg: row.shippingUpToKg,
    accountId: row.accountId,
    lastPostedAt: row.lastPostedAt?.toISOString() ?? null,
  }
}
