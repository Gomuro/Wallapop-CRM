import { getPrisma } from "../db"
import { log } from "../log"
import { markProductSoldTx } from "../product-sold"
import type { MonitorPlan } from "./diff"

export async function applyMonitorPlan(
  plan: MonitorPlan,
  accountId: string | null,
): Promise<void> {
  const prisma = getPrisma()
  if (!prisma) {
    log("warn", "wallapop_monitor_apply_no_db")
    return
  }

  for (const productId of plan.toSoldProductIds) {
    if (!accountId) {
      log("warn", "wallapop_monitor_sold_no_account", { productId })
      continue
    }
    const result = await markProductSoldTx(prisma, productId, { accountId })
    log("info", "wallapop_monitor_marked_sold", {
      productId,
      accountId,
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

  if (plan.toDeactivated.length > 0) {
    const updated = await prisma.productListing.updateMany({
      where: {
        id: { in: plan.toDeactivated },
        status: { in: ["ACTIVE", "RESERVED"] },
      },
      data: { status: "DEACTIVATED", externalUrl: null },
    })
    log("info", "wallapop_monitor_deactivated", {
      count: updated.count,
      ids: plan.toDeactivated,
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
