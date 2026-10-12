import { getPrisma } from "./db"
import { log, serializeError } from "./log"

const QUEUE_STATUSES = ["READY_TO_POST", "FAILED"] as const

type ListingClient = {
  productListing: {
    updateMany: (args: {
      where: unknown
      data: { status: "DEACTIVATED"; externalUrl: null }
    }) => Promise<{ count: number }>
  }
}

/** Inactivo warehouse cannot stay in the publish queue. */
export async function dequeueInactiveWarehouseQueue(
  prisma: ListingClient,
  productId?: string,
): Promise<number> {
  const result = await prisma.productListing.updateMany({
    where: {
      status: { in: [...QUEUE_STATUSES] },
      product: productId
        ? { id: productId, status: "INACTIVE" }
        : { status: "INACTIVE" },
    },
    data: { status: "DEACTIVATED", externalUrl: null },
  })
  return result.count
}

export async function dequeueInactiveWarehouseQueueOnBoot(): Promise<void> {
  const prisma = getPrisma()
  if (!prisma) return
  try {
    const count = await dequeueInactiveWarehouseQueue(prisma)
    if (count > 0) {
      log("info", "inactive_queue_cleared", { count })
    }
  } catch (error) {
    log("error", "inactive_queue_clear_failed", {
      error: serializeError(error),
    })
  }
}
