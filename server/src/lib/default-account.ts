import type { PrismaClient } from "../../generated/prisma/client"

export const DEFAULT_ACCOUNT_MISSING_MESSAGE =
  "Default account is not configured."

export async function findDefaultAccountId(
  prisma: PrismaClient,
): Promise<string | null> {
  const account = await prisma.account.findFirst({
    where: { isDefault: true },
    select: { id: true },
  })
  return account?.id ?? null
}
