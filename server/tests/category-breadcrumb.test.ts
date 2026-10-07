import { describe, expect, it } from "vitest"

import type { PrismaClient } from "../generated/prisma/client"
import { categoryBreadcrumbLabelsEs } from "../src/lib/category-breadcrumb"

type CategoryRow = {
  wallapopId: number
  nameEs: string
  verticalId: string | null
}

function prismaWith(path: string | null, rows: CategoryRow[]): PrismaClient {
  return {
    category: {
      findUnique: async () => (path == null ? null : { path }),
      findMany: async () => rows,
    },
  } as unknown as PrismaClient
}

const fashionPath = "100/12467/12465/"
const fashionRows: CategoryRow[] = [
  { wallapopId: 100, nameEs: "Coches", verticalId: "cars" },
  { wallapopId: 12467, nameEs: "Moda y accesorios", verticalId: "consumer_goods" },
  { wallapopId: 12465, nameEs: "Ropa", verticalId: "consumer_goods" },
]

describe("categoryBreadcrumbLabelsEs", () => {
  it("returns an empty list when the category or path is missing", async () => {
    await expect(
      categoryBreadcrumbLabelsEs(prismaWith(null, []), "missing"),
    ).resolves.toEqual([])
    await expect(
      categoryBreadcrumbLabelsEs(prismaWith("", fashionRows), "empty"),
    ).resolves.toEqual([])
    await expect(
      categoryBreadcrumbLabelsEs(prismaWith("abc//", fashionRows), "junk"),
    ).resolves.toEqual([])
  })

  it("returns Spanish labels from root to leaf", async () => {
    await expect(
      categoryBreadcrumbLabelsEs(prismaWith(fashionPath, fashionRows), "cat"),
    ).resolves.toEqual(["Coches", "Moda y accesorios", "Ropa"])
  })

  it("drops blank and unknown names", async () => {
    const rows: CategoryRow[] = [
      { wallapopId: 12467, nameEs: "  ", verticalId: "consumer_goods" },
      { wallapopId: 12465, nameEs: "Ropa", verticalId: "consumer_goods" },
    ]
    await expect(
      categoryBreadcrumbLabelsEs(prismaWith("12467/999/12465/", rows), "cat"),
    ).resolves.toEqual(["Ropa"])
  })

  it("trims motor and other excluded roots for consumer-goods publish", async () => {
    await expect(
      categoryBreadcrumbLabelsEs(prismaWith(fashionPath, fashionRows), "cat", {
        consumerGoodsPublish: true,
      }),
    ).resolves.toEqual(["Moda y accesorios", "Ropa"])
  })

  it("strips a path that is only excluded roots", async () => {
    const rows: CategoryRow[] = [
      { wallapopId: 100, nameEs: "Coches", verticalId: "cars" },
      { wallapopId: 14000, nameEs: "Motos", verticalId: "motor" },
    ]
    await expect(
      categoryBreadcrumbLabelsEs(prismaWith("100/14000/", rows), "cat", {
        consumerGoodsPublish: true,
      }),
    ).resolves.toEqual([])
  })

  it("keeps a non-excluded prefix that is not consumer goods", async () => {
    const rows: CategoryRow[] = [
      { wallapopId: 999, nameEs: "Otro", verticalId: "other" },
      { wallapopId: 100, nameEs: "Coches", verticalId: "cars" },
    ]
    await expect(
      categoryBreadcrumbLabelsEs(prismaWith("999/100/", rows), "cat", {
        consumerGoodsPublish: true,
      }),
    ).resolves.toEqual(["Otro", "Coches"])
  })
})
