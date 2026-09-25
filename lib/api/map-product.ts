import { resolveMediaUrl } from "@/lib/api/config"
import type {
  ApiCategory,
  ApiListing,
  ApiProduct,
  ApiProductListItem,
} from "@/lib/api/types"
import { conditionLabel } from "@/lib/inventory/conditions"
import type { InventoryListing, InventoryProduct } from "@/lib/inventory/types"
import type { ListingStatus } from "@/lib/validations"

export function mapApiListing(
  listing: ApiListing | null,
  accountName: string,
): InventoryListing | null {
  if (!listing) return null
  return {
    id: listing.id,
    accountId: listing.accountId,
    accountName,
    externalUrl: listing.externalUrl,
    status: listing.status as ListingStatus,
  }
}

export function mapListItemToInventory(row: ApiProductListItem): InventoryProduct {
  const cover = row.coverUrl ? resolveMediaUrl(row.coverUrl) : ""

  return {
    id: row.id,
    sku: row.sku,
    title: row.title,
    description: "",
    price: row.price,
    categoryId: row.categoryId,
    category: "",
    condition: "",
    conditionCode: "GOOD",
    weight: null,
    images: cover ? [cover] : [],
    productImages: [],
    status: row.status,
    externalLinks: [],
    createdAt: row.updatedAt,
    updatedAt: row.updatedAt,
    listing: null,
    listingActive: row.listingActive,
  }
}

export function mapProductToInventory(
  product: ApiProduct,
  category: ApiCategory | null,
  accountName: string,
): InventoryProduct {
  const images = product.images
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((image) => resolveMediaUrl(image.url))

  const listing = mapApiListing(product.listing, accountName)

  return {
    id: product.id,
    sku: product.sku,
    title: product.title,
    description: product.description,
    price: product.price,
    categoryId: product.categoryId,
    category: category?.nameEs ?? category?.nameUk ?? product.categoryId,
    condition: conditionLabel(product.condition),
    conditionCode: product.condition,
    weight: product.weightKg,
    images,
    productImages: product.images.map((image) => ({
      id: image.id,
      url: resolveMediaUrl(image.url),
      sortOrder: image.sortOrder,
    })),
    status: product.status,
    externalLinks: listing?.externalUrl ? [listing.externalUrl] : [],
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    listing,
    listingActive: listing?.status === "ACTIVE",
  }
}
