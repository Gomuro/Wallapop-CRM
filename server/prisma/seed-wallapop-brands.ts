import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import type { WallapopBrandsSnapshot } from "./wallapop-brand-options"

const SNAPSHOT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "data",
  "wallapop-brands.json",
)

type BrandSeedClient = {
  brand: {
    createMany: (args: {
      data: Array<{ wallapopId: string; name: string }>
      skipDuplicates: boolean
    }) => Promise<unknown>
    findMany: (args: {
      where: { wallapopId: { in: string[] } }
      select: { id: true; wallapopId: true }
    }) => Promise<Array<{ id: string; wallapopId: string }>>
  }
  category: {
    findMany: (args: {
      where: { wallapopId: { in: number[] } }
      select: { id: true; wallapopId: true }
    }) => Promise<Array<{ id: string; wallapopId: number }>>
  }
  brandCategory: {
    createMany: (args: {
      data: Array<{ brandId: string; categoryId: string }>
      skipDuplicates: boolean
    }) => Promise<unknown>
  }
}

export function loadBrandsSnapshot(): WallapopBrandsSnapshot | null {
  if (!existsSync(SNAPSHOT_PATH)) return null
  return JSON.parse(
    readFileSync(SNAPSHOT_PATH, "utf8"),
  ) as WallapopBrandsSnapshot
}

export async function seedWallapopBrands(prisma: BrandSeedClient) {
  const snapshot = loadBrandsSnapshot()
  if (!snapshot?.catalogs?.length) {
    console.log("brands snapshot missing, skip")
    return
  }

  const unique = new Map<string, string>()
  for (const catalog of snapshot.catalogs) {
    for (const brand of catalog.brands) {
      if (!unique.has(brand.id)) unique.set(brand.id, brand.title)
    }
  }

  await prisma.brand.createMany({
    data: [...unique.entries()].map(([wallapopId, name]) => ({
      wallapopId,
      name,
    })),
    skipDuplicates: true,
  })

  const brandRows = await prisma.brand.findMany({
    where: { wallapopId: { in: [...unique.keys()] } },
    select: { id: true, wallapopId: true },
  })
  const brandIdByWallapopId = new Map(
    brandRows.map((row) => [row.wallapopId, row.id]),
  )

  const leafIds = [
    ...new Set(
      snapshot.catalogs.flatMap((catalog) => catalog.leafWallapopIds),
    ),
  ]
  const categories = await prisma.category.findMany({
    where: { wallapopId: { in: leafIds } },
    select: { id: true, wallapopId: true },
  })
  const categoryIdByWallapopId = new Map(
    categories.map((row) => [row.wallapopId, row.id]),
  )

  const links: Array<{ brandId: string; categoryId: string }> = []
  for (const catalog of snapshot.catalogs) {
    for (const leaf of catalog.leafWallapopIds) {
      const categoryId = categoryIdByWallapopId.get(leaf)
      if (!categoryId) continue
      for (const brand of catalog.brands) {
        const brandId = brandIdByWallapopId.get(brand.id)
        if (!brandId) continue
        links.push({ brandId, categoryId })
      }
    }
  }

  const chunk = 1000
  for (let i = 0; i < links.length; i += chunk) {
    await prisma.brandCategory.createMany({
      data: links.slice(i, i + chunk),
      skipDuplicates: true,
    })
  }

  console.log(
    `brands=${unique.size} catalogs=${snapshot.catalogs.length} links=${links.length}`,
  )
}
