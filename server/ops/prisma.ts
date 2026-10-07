import { PrismaPg } from "@prisma/adapter-pg"

import { PrismaClient } from "../generated/prisma/client"

export function prismaForUrl(connectionString: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  })
}

export async function withPair<T>(
  localUrl: string,
  vpsUrl: string,
  fn: (local: PrismaClient, vps: PrismaClient) => Promise<T>,
): Promise<T> {
  const local = prismaForUrl(localUrl)
  const vps = prismaForUrl(vpsUrl)
  try {
    return await fn(local, vps)
  } finally {
    await Promise.all([local.$disconnect(), vps.$disconnect()])
  }
}
