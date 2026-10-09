import { getPrisma } from "../db"
import { log } from "../log"
import { markProductSoldTx } from "../product-sold"
import type { MonitorPlan } from "./diff"

export async function applyMonitorPlan(plan: MonitorPlan): Promise<void> {
  const prisma = getPrisma()
  if (!prisma) {
    log("warn", "wallapop_monitor_apply_no_db")
    return
  }

  for (const productId of plan.toSoldProductIds) {
    const result = await markProductSoldTx(prisma, productId, {})
    log("info", "wallapop_monitor_marked_sold", {
      productId,
      kind: result.kind,
    })
  }

  if (plan.toReserved.length > 0) {
    const updated = await prisma.productListing.updateMany({
      where: {
        id: { in: plan.toReserved },
        status: { in: ["ACTIVE", "RESERVED"] },
      },
      data: { status: "RESERVED" },
    })
    log("info", "wallapop_monitor_marked_reserved", {
      count: updated.count,
      ids: plan.toReserved,
    })
  }

  if (plan.toActive.length > 0) {
    const updated = await prisma.productListing.updateMany({
      where: {
        id: { in: plan.toActive },
        status: "RESERVED",
      },
      data: { status: "ACTIVE" },
    })
    log("info", "wallapop_monitor_cleared_reserved", {
      count: updated.count,
      ids: plan.toActive,
    })
  }
}
