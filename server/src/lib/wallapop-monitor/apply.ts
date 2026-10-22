import { chromePortForAccount } from "../account-chrome"
import { getPrisma } from "../db"
import { log } from "../log"
import { markProductSoldTx } from "../product-sold"
import { scheduleSiblingReserved } from "../sibling-reserve"
import { scheduleSiblingSold } from "../sibling-eliminar"
import { isCrmRemovalWorkerBusy } from "../wallapop-cdp"
import { recordUnseenMisses } from "../wallapop-restriction"
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

const MISSING_ROW_SELECT = {
  id: true,
  productId: true,
  accountId: true,
  status: true,
  externalUrl: true,
} as const

async function crmWorkerBusyOn(accountId: string): Promise<boolean> {
  return isCrmRemovalWorkerBusy(await chromePortForAccount(accountId))
}

/** One or many: keep URL, warehouse untouched. Idempotent if already MISSING. */
export async function markListingsMissing(
  listingIds: string[],
  accountId: string | null,
): Promise<number> {
  if (listingIds.length === 0) return 0
  const prisma = getPrisma()
  if (!prisma) {
    log("warn", "wallapop_monitor_apply_no_db")
    return 0
  }
  const rows = await prisma.productListing.findMany({
    where: {
      id: { in: listingIds },
      status: { in: ["ACTIVE", "RESERVED"] },
    },
    select: MISSING_ROW_SELECT,
  })
  if (rows.length === 0) return 0
  await prisma.productListing.updateMany({
    where: {
      id: { in: rows.map((row) => row.id) },
      status: { in: ["ACTIVE", "RESERVED"] },
    },
    data: { status: "MISSING" },
  })
  await recordUnseenMisses(prisma, rows, crmWorkerBusyOn)
  for (const row of rows) {
    log("info", "wallapop_monitor_listing_missing", {
      accountId,
      listingId: row.id,
      productId: row.productId,
      url: row.externalUrl,
    })
  }
  return rows.length
}

async function applyMissing(
  plan: MonitorPlan,
  accountId: string | null,
): Promise<void> {
  await markListingsMissing(plan.toMissing, accountId)
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
  await applyMissing(plan, accountId)
  await applyClearedReserved(prisma, plan)
}
