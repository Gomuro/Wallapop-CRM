import type { PrismaClient } from "../../../generated/prisma/client"
import { WallapopPublishError } from "../wallapop-publish/types"
import { savedListingVariant } from "./store"

export type PublishText = {
  title: string
  description: string
  price: number
}

export const VARIANT_NOT_READY_MESSAGE =
  "El texto del duplicado aún se está preparando; se publicará cuando esté listo."

/**
 * Text and price that go into the Wallapop form for (product, account). Never calls the AI.
 * Default account: the warehouse product as is. Any other account: the saved duplicate
 * text. Without one the claimed listing goes back to PREPARING (not FAILED) and the
 * background writer picks it up on its next tick; the original text never goes out.
 */
export async function publishTextForListing(
  prisma: PrismaClient,
  product: { id: string; title: string; description: string; price: number },
  accountId: string,
): Promise<PublishText> {
  const saved = await savedListingVariant(prisma, product.id, accountId)
  if (!saved.ready) {
    await prisma.productListing.updateMany({
      where: { productId: product.id, accountId, status: "POSTING" },
      // The claim counted a posting attempt; waiting for text is not one.
      data: { status: "PREPARING", variantNextAttemptAt: new Date(), postingAttempts: { decrement: 1 } },
    })
    throw new WallapopPublishError("form", VARIANT_NOT_READY_MESSAGE)
  }
  if (!saved.data) {
    return { title: product.title, description: product.description, price: product.price }
  }
  return {
    title: saved.data.variantTitle,
    description: saved.data.variantDescription,
    price: saved.data.variantPrice,
  }
}
