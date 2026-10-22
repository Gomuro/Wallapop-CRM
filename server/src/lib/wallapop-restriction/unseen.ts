import type { PrismaClient } from "../../../generated/prisma/client"

import { evaluateUnseenStreak } from "./store"

type Db = Pick<PrismaClient, "account" | "productListing">

export type MissingRow = { id: string; accountId: string; status: string }

/**
 * Stamp `missingAt` on ads that vanished with no CRM action, then re-check the
 * streak of each account. Only ACTIVE ads count (a RESERVED ad was touched by
 * us), and `crmWorkerBusy` tells whether Eliminar/Vendido/Reservar is running.
 */
export async function recordUnseenMisses(
  prisma: Db,
  rows: MissingRow[],
  crmWorkerBusy: (accountId: string) => Promise<boolean>,
  now = new Date(),
): Promise<void> {
  const counted: MissingRow[] = []
  for (const row of rows) {
    if (row.status !== "ACTIVE") continue
    if (await crmWorkerBusy(row.accountId)) continue
    counted.push(row)
  }
  if (counted.length === 0) return
  await prisma.productListing.updateMany({
    where: { id: { in: counted.map((row) => row.id) } },
    data: { missingAt: now },
  })
  for (const accountId of new Set(counted.map((row) => row.accountId))) {
    await evaluateUnseenStreak(prisma, accountId, now)
  }
}
