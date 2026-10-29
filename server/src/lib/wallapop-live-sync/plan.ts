import type { CrmLiveRow, LiveMark } from "../wallapop-live-mark"

const QUEUE_STATUSES = new Set(["READY_TO_POST", "FAILED"])

export type LiveSyncLink = {
  row: CrmLiveRow
  mark: Extract<LiveMark, { action: "hanging" }>
}

export type LiveSyncAmbiguous = {
  row: CrmLiveRow
  /** twin_product: another CRM product has the same title and price. several_live: more than one ad fits. */
  why: "twin_product" | "several_live"
}

export type LiveSyncPlan = { link: LiveSyncLink[]; ambiguous: LiveSyncAmbiguous[] }

function twinKey(row: CrmLiveRow): string {
  return `${row.title.trim().replace(/\s+/g, " ").toLowerCase()}|${row.price.toFixed(2)}`
}

/**
 * Queued rows (READY / FAILED) that are already on the public profile. A title match is
 * trusted only when no other CRM product shares that title and price: two such products
 * (Lionelo, Ariston) can't tell which ad is whose, so they are only reported.
 */
export function planLiveSync(catalog: { rows: CrmLiveRow[]; marks: LiveMark[] }): LiveSyncPlan {
  const twins = new Map<string, number>()
  for (const row of catalog.rows) twins.set(twinKey(row), (twins.get(twinKey(row)) ?? 0) + 1)
  const byId = new Map(catalog.rows.map((row) => [row.listingId, row]))
  const plan: LiveSyncPlan = { link: [], ambiguous: [] }
  for (const mark of catalog.marks) {
    const row = byId.get(mark.listingId)
    if (!row || !QUEUE_STATUSES.has(row.listingStatus)) continue
    if (mark.action === "leave" && mark.reason === "ambiguous") {
      plan.ambiguous.push({ row, why: "several_live" })
    } else if (mark.action === "hanging") {
      if (mark.reason === "title" && (twins.get(twinKey(row)) ?? 0) > 1) {
        plan.ambiguous.push({ row, why: "twin_product" })
      } else {
        plan.link.push({ row, mark })
      }
    }
  }
  return plan
}
