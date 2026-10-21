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

function tallyProbes(probes: Record<string, ItemLiveProbe>) {
  let gone = 0
  let live = 0
  let unknown = 0
  for (const result of Object.values(probes)) {
    if (result === "gone") gone += 1
    else if (result === "live") live += 1
    else unknown += 1
  }
  return { gone, live, unknown }
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
  const total = candidateIds.length
  log("info", "wallapop_monitor_item_probe_start", { accountId, total })
  for (const [i, id] of candidateIds.entries()) {
    const listing = byId.get(id)
    const url = listing?.externalUrl
    const index = i + 1
    if (!url) {
      probes[id] = "unknown"
      log("info", "wallapop_monitor_item_probe", {
        accountId,
        index,
        total,
        listingId: id,
        result: "unknown",
        reason: "no_url",
      })
      continue
    }
    log("info", "wallapop_monitor_item_probe_open", {
      accountId,
      index,
      total,
      listingId: id,
      url,
    })
    const probe = await probeOneItem(page, url)
    probes[id] = probe
    let pageTitle = ""
    try {
      pageTitle = await page.title()
    } catch {
      pageTitle = ""
    }
    log("info", "wallapop_monitor_item_probe", {
      accountId,
      index,
      total,
      listingId: id,
      result: probe,
      url,
      pageUrl: page.url(),
      pageTitle,
    })
    if (probe === "live") {
      log("info", "wallapop_monitor_item_still_live", {
        accountId,
        listingId: id,
        url,
      })
    }
  }
  const goneIds = missingIdsAfterItemProbes(candidateIds, probes)
  log("info", "wallapop_monitor_item_probe_done", {
    accountId,
    total,
    ...tallyProbes(probes),
    toMissing: goneIds.length,
  })
  return goneIds
}
