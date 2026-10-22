import type { PrismaClient } from "../../../generated/prisma/client"

import { log, serializeError } from "../log"
import { UNSEEN_STREAK_LIMIT } from "./constants"
import { RESTRICTION_REASONS, type RestrictionSignal } from "./signals"
import { countUnseenStreak } from "./streak"

type Db = Pick<PrismaClient, "account" | "productListing">

const RECENT_LISTINGS = 20

/**
 * Record a suspicion and stop this account's autopost. The first reason is
 * kept. Does not touch the Wallapop session or the listings.
 */
export async function suspectRestriction(
  prisma: Db,
  accountId: string,
  signal: RestrictionSignal,
  now = new Date(),
): Promise<void> {
  await prisma.account.updateMany({
    where: { id: accountId, restrictionSuspectedAt: null },
    data: {
      restrictionSuspectedAt: now,
      restrictionReason: RESTRICTION_REASONS[signal],
    },
  })
  await prisma.account.updateMany({
    where: { id: accountId },
    data: { autopostEnabled: false },
  })
  log("warn", "wallapop_restriction_suspected", { accountId, signal })
}

/** For hot paths (publish, login): a failed note must not hide the real error. */
export async function suspectRestrictionQuietly(
  prisma: Db,
  accountId: string,
  signal: RestrictionSignal,
): Promise<void> {
  try {
    await suspectRestriction(prisma, accountId, signal)
  } catch (error) {
    log("warn", "wallapop_restriction_note_failed", serializeError(error))
  }
}

export async function dismissRestriction(
  prisma: Db,
  accountId: string,
): Promise<void> {
  await prisma.account.update({
    where: { id: accountId },
    data: { restrictionSuspectedAt: null, restrictionReason: null },
  })
  log("info", "wallapop_restriction_dismissed", { accountId })
}

export async function isRestrictionSuspected(
  prisma: Db,
  accountId: string,
): Promise<boolean> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { restrictionSuspectedAt: true },
  })
  return account?.restrictionSuspectedAt != null
}

/** Raise the unseen-publications signal when the streak reaches the limit. */
export async function evaluateUnseenStreak(
  prisma: Db,
  accountId: string,
  now = new Date(),
): Promise<boolean> {
  const rows = await prisma.productListing.findMany({
    where: { accountId, lastPostedAt: { not: null } },
    orderBy: { lastPostedAt: "desc" },
    take: RECENT_LISTINGS,
    select: { status: true, lastPostedAt: true, missingAt: true },
  })
  if (countUnseenStreak(rows, now) < UNSEEN_STREAK_LIMIT) return false
  await suspectRestriction(prisma, accountId, "UNSEEN_PUBLICATIONS", now)
  return true
}
