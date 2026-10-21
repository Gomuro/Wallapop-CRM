import type { Page } from "playwright"

import { log, serializeError } from "../log"
import { itemPageStillLive } from "../wallapop-eliminar/verify"
import { markListingsMissing } from "./apply"
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

async function pageTitleOf(page: Page): Promise<string> {
  try {
    return await page.title()
  } catch {
    return ""
  }
}

async function markGoneListing(listingId: string, accountId: string): Promise<void> {
  try {
    await markListingsMissing([listingId], accountId)
  } catch (error) {
    log("warn", "wallapop_monitor_listing_missing_failed", {
      accountId,
      listingId,
      err: serializeError(error),
    })
  }
}

type ProbeCtx = {
  page: Page
  accountId: string
  index: number
  total: number
  listingId: string
}

async function probeCandidate(
  ctx: ProbeCtx,
  url: string | null | undefined,
): Promise<ItemLiveProbe> {
  const { page, accountId, index, total, listingId } = ctx
  if (!url) {
    log("info", "wallapop_monitor_item_probe", {
      accountId,
      index,
      total,
      listingId,
      result: "unknown",
      reason: "no_url",
    })
    return "unknown"
  }
  log("info", "wallapop_monitor_item_probe_open", {
    accountId,
    index,
    total,
    listingId,
    url,
  })
  const probe = await probeOneItem(page, url)
  log("info", "wallapop_monitor_item_probe", {
    accountId,
    index,
    total,
    listingId,
    result: probe,
    url,
    pageUrl: page.url(),
    pageTitle: await pageTitleOf(page),
  })
  if (probe === "live") {
    log("info", "wallapop_monitor_item_still_live", { accountId, listingId, url })
  }
  if (probe === "gone") await markGoneListing(listingId, accountId)
  return probe
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
    probes[id] = await probeCandidate(
      { page, accountId, index: i + 1, total, listingId: id },
      byId.get(id)?.externalUrl,
    )
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
