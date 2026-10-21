import { getPrisma } from "../db"
import { log } from "../log"
import { markProductSoldTx } from "../product-sold"
import { scheduleSiblingReserved } from "../sibling-reserve"
import { scheduleSiblingSold } from "../sibling-eliminar"
import type { MonitorPlan } from "./diff"

type MonitorDb = NonNullable<ReturnType<typeof getPrisma>>

async function applySoldProducts(
  prisma: MonitorDb,
  plan: MonitorPlan,
  accountId: string | null,
): Promise<void> {
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
    if (result.kind === "ok") {
      void scheduleSiblingSold(productId, accountId)
    }
  }
}

async function applyReserved(
  prisma: MonitorDb,
  plan: MonitorPlan,
  accountId: string | null,
): Promise<void> {
  if (plan.toReserved.length === 0) return
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
  if (!accountId) return
  const rows = await prisma.productListing.findMany({
    where: { id: { in: plan.toReserved } },
    select: { productId: true },
  })
  for (const productId of new Set(rows.map((row) => row.productId))) {
    void scheduleSiblingReserved(productId, accountId)
  }
}

async function applyMissing(
  prisma: MonitorDb,
  plan: MonitorPlan,
  accountId: string | null,
): Promise<void> {
  if (plan.toMissing.length === 0) return
  const rows = await prisma.productListing.findMany({
    where: {
      id: { in: plan.toMissing },
      status: { in: ["ACTIVE", "RESERVED"] },
    },
    select: { id: true, productId: true, externalUrl: true },
  })
  if (rows.length === 0) return
  await prisma.productListing.updateMany({
    where: {
      id: { in: rows.map((row) => row.id) },
      status: { in: ["ACTIVE", "RESERVED"] },
    },
    data: { status: "MISSING" },
  })
  for (const row of rows) {
    log("info", "wallapop_monitor_listing_missing", {
      accountId,
      listingId: row.id,
      productId: row.productId,
      url: row.externalUrl,
    })
  }
}

async function applyClearedReserved(
  prisma: MonitorDb,
  plan: MonitorPlan,
): Promise<void> {
  if (plan.toActive.length === 0) return
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

export async function applyMonitorPlan(
  plan: MonitorPlan,
  accountId: string | null,
): Promise<void> {
  const prisma = getPrisma()
  if (!prisma) {
    log("warn", "wallapop_monitor_apply_no_db")
    return
  }
  await applySoldProducts(prisma, plan, accountId)
  await applyReserved(prisma, plan, accountId)
  await applyMissing(prisma, plan, accountId)
  await applyClearedReserved(prisma, plan)
}
