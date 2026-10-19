import type { getPrisma } from "./db"

const SETTING_ID = "app"

type PrismaDb = NonNullable<ReturnType<typeof getPrisma>>

export async function readQueueNewProductAllAccounts(
  prisma: PrismaDb,
): Promise<boolean> {
  const row = await prisma.operatorSetting.findUnique({
    where: { id: SETTING_ID },
    select: { queueNewProductAllAccounts: true },
  })
  return row?.queueNewProductAllAccounts === true
}

export async function writeQueueNewProductAllAccounts(
  prisma: PrismaDb,
  enabled: boolean,
): Promise<boolean> {
  const row = await prisma.operatorSetting.upsert({
    where: { id: SETTING_ID },
    create: { id: SETTING_ID, queueNewProductAllAccounts: enabled },
    update: { queueNewProductAllAccounts: enabled },
    select: { queueNewProductAllAccounts: true },
  })
  return row.queueNewProductAllAccounts
}
