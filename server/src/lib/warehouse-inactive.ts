import type { Prisma } from "../../generated/prisma/client"

import { getPrisma } from "./db"
import { log, serializeError } from "./log"

const QUEUE_STATUSES = ["READY_TO_POST", "FAILED"] as const

type ListingClient = {
  productListing: {
    updateMany: (args: {
      where: Prisma.ProductListingWhereInput
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

/** Queue means selected for publish: Inactivo + Listo para publicar → En venta. */
export async function activateWarehouseForReadyQueueOnBoot(): Promise<void> {
  const prisma = getPrisma()
  if (!prisma) return
  try {
    const result = await prisma.product.updateMany({
      where: {
        status: "INACTIVE",
        listings: { some: { status: "READY_TO_POST" } },
      },
      data: { status: "ACTIVE" },
    })
    if (result.count > 0) {
      log("info", "ready_queue_activated_warehouse", { count: result.count })
    }
  } catch (error) {
    log("error", "ready_queue_activate_failed", {
      error: serializeError(error),
    })
  }
}
