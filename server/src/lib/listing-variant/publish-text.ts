import type { PrismaClient } from "../../../generated/prisma/client"
import { sameCents } from "../../../../lib/inventory/duplicate-price"
import { WallapopPublishError } from "../wallapop-publish/types"
import { savedListingVariant } from "./store"

export type PublishText = {
  title: string
  description: string
  price: number
}

export const VARIANT_NOT_READY_MESSAGE =
  "El texto del duplicado aún se está preparando; se publicará cuando esté listo."

/** Shown on a duplicate that would cost the same as the original; a person decides. */
export const DUPLICATE_SAME_PRICE_MESSAGE =
  "El precio del duplicado coincide con el original. Cambia el precio del producto o la terminación de la cuenta y vuelve a ponerlo en cola."

/** The claimed listing leaves the queue as FAILED with the reason; nothing reaches Chrome. */
async function refuseSamePrice(prisma: PrismaClient, productId: string, accountId: string): Promise<never> {
  await prisma.productListing.updateMany({
    where: { productId, accountId, status: "POSTING" },
    data: { status: "FAILED", lastPublishError: DUPLICATE_SAME_PRICE_MESSAGE, postingAttempts: { decrement: 1 } },
  })
  throw new WallapopPublishError("form", DUPLICATE_SAME_PRICE_MESSAGE)
}

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
  if (sameCents(saved.data.variantPrice, product.price)) await refuseSamePrice(prisma, product.id, accountId)
  return {
    title: saved.data.variantTitle,
    description: saved.data.variantDescription,
    price: saved.data.variantPrice,
  }
}
