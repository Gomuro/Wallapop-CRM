import { getPrisma } from "../db"
import { log } from "../log"
import { loadSellerCatalog } from "../wallapop-already-live"
import type { PublishedCatalogRow } from "./catalog"

/**
 * What is for sale and what is reserved, for the monitor: the public seller profile, the
 * same source the live sync reads. The Pro catalog table in Chrome split its pages
 * inconsistently (29.10: lists of 511 and 500 within one pass, pages showing another
 * page's rows, pages that never loaded), so it is no longer read for Activos.
 *
 * Null = the profile could not be read, or it came back empty while the CRM has ads on
 * Wallapop: the pass is incomplete and nothing is applied.
 */
export async function readPublishedFromProfile(
  accountId: string,
  liveInCrm: number,
): Promise<PublishedCatalogRow[] | null> {
  const prisma = getPrisma()
  if (!prisma) return null
  const items = await loadSellerCatalog(prisma, accountId)
  if (!items) return null
  if (items.length === 0 && liveInCrm > 0) {
    log("warn", "wallapop_monitor_profile_empty", { accountId, liveInCrm })
    return null
  }
  return items.map((item) => ({ href: item.href, reserved: item.reserved }))
}
