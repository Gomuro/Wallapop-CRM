import type { PrismaClient } from "../../generated/prisma/client"
import { WallapopPublishError } from "../lib/wallapop-publish"
import { suspectRestrictionQuietly } from "../lib/wallapop-restriction"

/** A signout mid-publish is a restriction hint: stop this account's autopost. */
export async function noteForcedSignout(
  target: { prisma: PrismaClient; accountId: string },
  error: unknown,
): Promise<void> {
  if (!(error instanceof WallapopPublishError) || !error.forcedSignout) return
  await suspectRestrictionQuietly(target.prisma, target.accountId, "FORCED_SIGNOUT")
}
