import type { PrismaClient } from "../../../generated/prisma/client"
import { WallapopPublishError } from "../wallapop-publish/types"
import { ensureListingVariant } from "./store"

export type PublishText = {
  title: string
  description: string
  price: number
}

/**
 * Text and price that go into the Wallapop form for (product, account).
 * Default account: the warehouse product as is. Any other account: the
 * duplicate variant, generated here if missing or stale. Without a valid
 * variant the listing fails: a duplicate never goes out with the original text.
 */
export async function publishTextForListing(
  prisma: PrismaClient,
  product: { id: string; title: string; description: string; price: number },
  accountId: string,
): Promise<PublishText> {
  const outcome = await ensureListingVariant(prisma, product.id, accountId)
  if (!outcome.ok) {
    throw new WallapopPublishError(
      "form",
      `Sin texto propio para el duplicado: ${outcome.error}`,
      { failListing: true },
    )
  }
  if (!outcome.data) {
    return { title: product.title, description: product.description, price: product.price }
  }
  return {
    title: outcome.data.variantTitle,
    description: outcome.data.variantDescription,
    price: outcome.data.variantPrice,
  }
}
