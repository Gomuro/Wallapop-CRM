import type { PrismaClient } from "../generated/prisma/client"

import { applyWarehouse, listingBySku, loadWarehouse } from "./warehouse"

function printReport(
  label: string,
  report: { upserted: string[]; skipped: { sku: string; reason: string }[] },
  dryRun: boolean,
): void {
  console.log(
    JSON.stringify(
      { action: label, dryRun, count: report.upserted.length, ...report },
      null,
      2,
    ),
  )
}

/** Copy warehouse rows from VPS onto local Docker. Leaves local autopost off. */
export async function refreshLocal(
  local: PrismaClient,
  vps: PrismaClient,
  dryRun: boolean,
): Promise<void> {
  const products = await loadWarehouse(vps)
  const report = await applyWarehouse({
    prisma: local,
    products,
    dryRun,
    muteAutopost: true,
  })
  printReport("refresh-local", report, dryRun)
}

/** Copy one listing’s Wallapop URL/status from local onto VPS (same SKU). */
export async function refreshVpsListing(
  local: PrismaClient,
  vps: PrismaClient,
  sku: string,
  dryRun: boolean,
): Promise<void> {
  const from = await listingBySku(local, sku)
  if (!from?.listing) {
    throw new Error(`Local SKU ${sku} has no listing to copy.`)
  }
  const onto = await listingBySku(vps, sku)
  if (!onto?.listing) {
    throw new Error(`VPS has no listing for SKU ${sku}.`)
  }
  const patch = {
    status: from.listing.status,
    externalUrl: from.listing.externalUrl,
    externalItemId: from.listing.externalItemId,
    lastPostedAt: from.listing.lastPostedAt,
    lastEditedAt: from.listing.lastEditedAt,
  }
  if (!dryRun) {
    await vps.productListing.update({
      where: { id: onto.listing.id },
      data: patch,
    })
  }
  console.log(JSON.stringify({ action: "refresh-vps", sku, dryRun, patch }, null, 2))
}
