import type { PrismaClient } from "../../../generated/prisma/client"

import { LoginSignalError } from "./signals"
import { suspectRestriction } from "./store"

type Db = Pick<PrismaClient, "account" | "productListing">

/**
 * reCAPTCHA is always a hint. "Wrong password" is a hint only for the email
 * this account already logged in with before; a first login may just be a typo.
 */
export async function noteLoginFailure(
  prisma: Db,
  accountId: string,
  email: string,
  error: unknown,
): Promise<void> {
  if (!(error instanceof LoginSignalError)) return
  if (error.signal === "LOGIN_REJECTED") {
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { wallapopEmail: true },
    })
    if (account?.wallapopEmail !== email) return
  }
  await suspectRestriction(prisma, accountId, error.signal)
}
