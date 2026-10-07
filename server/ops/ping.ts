import type { PrismaClient } from "../generated/prisma/client"

async function countPair(prisma: PrismaClient) {
  const [products, listings, categories] = await Promise.all([
    prisma.product.count(),
    prisma.productListing.count(),
    prisma.category.count(),
  ])
  return { products, listings, categories }
}

export async function pingBoth(
  local: PrismaClient,
  vps: PrismaClient,
): Promise<void> {
  const [here, there] = await Promise.all([
    countPair(local),
    countPair(vps),
  ])
  console.log(JSON.stringify({ local: here, vps: there }, null, 2))
}
