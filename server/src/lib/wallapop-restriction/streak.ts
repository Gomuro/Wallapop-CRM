import { UNSEEN_WINDOW_MS } from "./constants"

export type StreakListing = {
  status: string
  lastPostedAt: Date | null
  missingAt: Date | null
}

type Verdict = "unseen" | "seen" | "undecided"

function classify(row: StreakListing, now: Date): Verdict {
  if (!row.lastPostedAt) return "undecided"
  const postedAt = row.lastPostedAt.getTime()
  if (row.status === "MISSING") {
    if (!row.missingAt) return "undecided"
    return row.missingAt.getTime() - postedAt <= UNSEEN_WINDOW_MS
      ? "unseen"
      : "seen"
  }
  const lived = now.getTime() - postedAt >= UNSEEN_WINDOW_MS
  return lived && (row.status === "ACTIVE" || row.status === "RESERVED")
    ? "seen"
    : "undecided"
}

/**
 * Consecutive unseen publications, newest first, stopping at the first ad
 * that lived the whole window. Ads removed by a CRM worker have no missingAt
 * and ads that are still young are undecided: neither count nor reset.
 */
export function countUnseenStreak(
  newestFirst: StreakListing[],
  now: Date,
): number {
  let streak = 0
  for (const row of newestFirst) {
    const verdict = classify(row, now)
    if (verdict === "seen") break
    if (verdict === "unseen") streak += 1
  }
  return streak
}
