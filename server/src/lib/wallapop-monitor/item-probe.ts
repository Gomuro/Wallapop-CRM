import type { Page } from "playwright"

import { log, serializeError } from "../log"
import { itemPageStillLive } from "../wallapop-eliminar/verify"
import {
  missingIdsAfterItemProbes,
  type ItemLiveProbe,
  type MonitorCrmListing,
} from "./diff"

async function probeOneItem(page: Page, itemUrl: string): Promise<ItemLiveProbe> {
  try {
    const live = await itemPageStillLive(page, itemUrl)
    return live ? "live" : "gone"
  } catch (error) {
    log("warn", "wallapop_monitor_item_probe_failed", {
      url: itemUrl,
      err: serializeError(error),
    })
    return "unknown"
  }
}

/** Catalog-missing rows: only mark MISSING when the seller /item/ page is gone. */
export async function confirmMissingItemPages(
  page: Page,
  listings: MonitorCrmListing[],
  candidateIds: string[],
  accountId: string,
): Promise<string[]> {
  if (candidateIds.length === 0) return []
  const byId = new Map(listings.map((listing) => [listing.id, listing]))
  const probes: Record<string, ItemLiveProbe> = {}
  for (const id of candidateIds) {
    const listing = byId.get(id)
    const url = listing?.externalUrl
    if (!url) {
      probes[id] = "unknown"
      continue
    }
    const probe = await probeOneItem(page, url)
    probes[id] = probe
    if (probe === "live") {
      log("info", "wallapop_monitor_item_still_live", {
        accountId,
        listingId: id,
        url,
      })
    }
  }
  return missingIdsAfterItemProbes(candidateIds, probes)
}
