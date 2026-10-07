import type { PrismaClient } from "../../generated/prisma/client"

import { log } from "./log"

export function normalizeWallapopEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** True when a stored identity exists and differs from the incoming email. */
export function wallapopIdentityChanged(
  stored: string | null | undefined,
  incoming: string,
): boolean {
  if (stored == null || stored.trim() === "") return false
  return normalizeWallapopEmail(stored) !== normalizeWallapopEmail(incoming)
}

export type WallapopIdentitySyncResult = {
  listingsReset: boolean
}

/**
 * Bind the default CRM account to this Wallapop email.
 * First login stores the email. Same email keeps listings.
 * A different email resets listings to READY_TO_POST and stops autopost.
 */
export async function syncWallapopIdentityOnActive(
  prisma: PrismaClient,
  incomingEmail: string,
): Promise<WallapopIdentitySyncResult> {
  const email = normalizeWallapopEmail(incomingEmail)
  if (!email) return { listingsReset: false }

  const account = await prisma.account.findFirst({
    where: { isDefault: true },
    select: {
      id: true,
      wallapopEmail: true,
    },
  })
  if (!account) return { listingsReset: false }

  if (!account.wallapopEmail) {
    await prisma.account.update({
      where: { id: account.id },
      data: { wallapopEmail: email },
    })
    return { listingsReset: false }
  }

  if (!wallapopIdentityChanged(account.wallapopEmail, email)) {
    return { listingsReset: false }
  }

  await prisma.$transaction([
    prisma.productListing.updateMany({
      where: { accountId: account.id },
      data: {
        status: "READY_TO_POST",
        externalUrl: null,
        externalItemId: null,
        lastPostedAt: null,
        postingAttempts: 0,
        lastPublishError: null,
      },
    }),
    prisma.account.update({
      where: { id: account.id },
      data: {
        wallapopEmail: email,
        autopostEnabled: false,
      },
    }),
  ])

  log("info", "wallapop_account_identity_changed", {
    accountId: account.id,
    from: account.wallapopEmail,
    to: email,
  })
  return { listingsReset: true }
}
