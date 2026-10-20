import type { PrismaClient } from "../../../generated/prisma/client"

import { getRecentAutopostSkips } from "../autopost-recent-skips"
import { getPrisma } from "../db"
import { accountNextTickAt, extraDesk, getNextAutopostTickAt, isAutopostTickRunning } from "./desk"
import { resolveAutopostInterval, toAutopostStatusJson } from "./interval"

type AutopostAccount = {
  id: string
  isDefault: boolean
  autopostEnabled: boolean
}

function findAutopostAccount(prisma: PrismaClient, accountId?: string) {
  const select = { id: true, isDefault: true, autopostEnabled: true } as const
  if (!accountId) {
    return prisma.account.findFirst({
      where: { isDefault: true },
      select,
    })
  }
  return prisma.account.findUnique({
    where: { id: accountId },
    select,
  })
}

function loadLastPosted(prisma: PrismaClient, account: AutopostAccount | null) {
  if (!account) return null
  return prisma.productListing.findFirst({
    where: {
      accountId: account.id,
      lastPostedAt: { not: null },
    },
    orderBy: { lastPostedAt: "desc" },
    select: {
      lastPostedAt: true,
      product: { select: { title: true } },
    },
  })
}

function countReadyToPost(prisma: PrismaClient, account: AutopostAccount | null) {
  if (!account) return Promise.resolve(0)
  return prisma.productListing.count({
    where: { status: "READY_TO_POST", accountId: account.id },
  })
}

function nextTickFor(account: AutopostAccount | null, enabled: boolean): string | null {
  if (!enabled) return null
  if (account?.isDefault === false) return accountNextTickAt(account.id)
  return getNextAutopostTickAt()
}

function publishingFor(account: AutopostAccount | null, enabled: boolean): boolean {
  if (!enabled) return false
  if (account?.isDefault === false) return extraDesk(account.id).running
  return isAutopostTickRunning()
}

export async function loadAutopostStatus(
  prisma: PrismaClient,
  accountId?: string,
) {
  const account = await findAutopostAccount(prisma, accountId)
  const resolution = await resolveAutopostInterval(prisma, account?.id)
  const last = await loadLastPosted(prisma, account)
  const enabled = account?.autopostEnabled === true
  const readyToPostCount = await countReadyToPost(prisma, account)
  return toAutopostStatusJson(resolution, {
    enabled,
    lastPublication:
      last?.lastPostedAt != null
        ? { at: last.lastPostedAt.toISOString(), title: last.product.title }
        : null,
    nextTickAt: nextTickFor(account, enabled),
    publishing: publishingFor(account, enabled),
    readyToPostCount,
    recentSkips: getRecentAutopostSkips(),
  })
}

export async function isDefaultAccountAutopostEnabled(
  prisma?: PrismaClient | null,
): Promise<boolean> {
  const client = prisma === undefined ? getPrisma() : prisma
  if (!client) return false
  const account = await client.account.findFirst({
    where: { isDefault: true },
    select: { autopostEnabled: true },
  })
  return account?.autopostEnabled === true
}
