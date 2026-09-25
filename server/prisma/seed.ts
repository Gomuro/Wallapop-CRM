import "../load-env"

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import bcrypt from "bcryptjs"

import {
  assertWallapopTreeCounts,
  flattenWallapopCategories,
  WALLAPOP_TREE_COUNTS,
  type FlatCategory,
  type WallapopApiNode,
} from "./flatten-wallapop-categories"

type SeedClient = {
  user: {
    upsert: (args: {
      where: { email: string }
      create: { email: string; passwordHash: string; name: string }
      update: { passwordHash: string; name: string }
    }) => Promise<unknown>
  }
}

const SNAPSHOT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "data",
  "wallapop-categories.json",
)

const DEFAULT_ACCOUNT_NAME = "Wallapop default"

function isDryRun(argv: string[]) {
  return argv.includes("--dry-run")
}

function loadSnapshot() {
  const raw = readFileSync(SNAPSHOT_PATH, "utf8")
  return JSON.parse(raw) as { categories?: WallapopApiNode[] }
}

function flattenAndAssert(): FlatCategory[] {
  const rows = flattenWallapopCategories(loadSnapshot())
  assertWallapopTreeCounts(rows)
  const roots = rows.filter((row) => row.parentWallapopId === null).length
  const leaves = rows.filter((row) => row.isLeaf).length
  const maxDepth = Math.max(...rows.map((row) => row.depth))
  const sample = rows.find((row) => row.depth === maxDepth && row.isLeaf)
  console.log(
    `roots=${roots} nodes=${rows.length} leaves=${leaves} maxDepth=${maxDepth}`,
  )
  if (sample) {
    console.log(`exampleDepth${maxDepth}=${sample.path}`)
  }
  return rows
}

function categoryWriteData(row: FlatCategory, parentId: string | null) {
  return {
    parentId,
    slug: row.slug,
    nameEs: row.nameEs,
    nameUk: row.nameUk,
    isLeaf: row.isLeaf,
    leafSelectionMandatory: row.leafSelectionMandatory,
    verticalId: row.verticalId,
    listingType: row.listingType,
    path: row.path,
    depth: row.depth,
    attributes: (row.attributes ?? {}) as object,
    seoLegacyId: row.seoLegacyId,
    sortOrder: row.sortOrder,
  }
}

async function seedOperator(prisma: SeedClient) {
  const email = process.env.SEED_USER_EMAIL?.trim().toLowerCase()
  const password = process.env.SEED_USER_PASSWORD
  const name = process.env.SEED_USER_NAME?.trim() || "Operator"
  if (!email || !password) {
    console.warn(
      "SEED_USER_EMAIL / SEED_USER_PASSWORD not set — skip operator user",
    )
    return
  }
  if (password.length < 8) {
    throw new Error("SEED_USER_PASSWORD must be at least 8 characters")
  }
  const passwordHash = await bcrypt.hash(password, 10)
  await prisma.user.upsert({
    where: { email },
    create: { email, passwordHash, name },
    update: { passwordHash, name },
  })
  console.log(`operator user ${email}`)
}

async function seedDatabase(rows: FlatCategory[]) {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error(
      "DATABASE_URL is not set. Run with --dry-run to flatten and assert counts without a database.",
    )
    process.exit(1)
  }

  const { PrismaPg } = await import("@prisma/adapter-pg")
  const { PrismaClient } = await import("../generated/prisma/client")

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  })

  try {
    const idByWallapopId = new Map<number, string>()
    const depths = [...new Set(rows.map((row) => row.depth))].sort(
      (a, b) => a - b,
    )

    for (const depth of depths) {
      const batch = rows.filter((row) => row.depth === depth)
      for (const row of batch) {
        const parentId =
          row.parentWallapopId == null
            ? null
            : (idByWallapopId.get(row.parentWallapopId) ?? null)
        if (row.parentWallapopId != null && parentId == null) {
          throw new Error(
            `Missing parent wallapop_id=${row.parentWallapopId} for ${row.wallapopId}`,
          )
        }

        const saved = await prisma.category.upsert({
          where: { wallapopId: row.wallapopId },
          create: {
            wallapopId: row.wallapopId,
            ...categoryWriteData(row, parentId),
          },
          update: categoryWriteData(row, parentId),
        })
        idByWallapopId.set(row.wallapopId, saved.id)
      }
    }

    const count = await prisma.category.count()
    if (count !== WALLAPOP_TREE_COUNTS.nodes) {
      throw new Error(
        `Seeded category count mismatch: got ${count}, expected ${WALLAPOP_TREE_COUNTS.nodes}`,
      )
    }

    const existingDefault = await prisma.account.findFirst({
      where: { isDefault: true },
    })
    if (existingDefault) {
      await prisma.account.update({
        where: { id: existingDefault.id },
        data: {
          name: DEFAULT_ACCOUNT_NAME,
          status: "ACTIVE",
          isDefault: true,
        },
      })
    } else {
      await prisma.account.create({
        data: {
          name: DEFAULT_ACCOUNT_NAME,
          status: "ACTIVE",
          isDefault: true,
        },
      })
    }

    await seedOperator(prisma)
  } finally {
    await prisma.$disconnect()
  }
}

async function main() {
  const rows = flattenAndAssert()
  if (isDryRun(process.argv)) return
  await seedDatabase(rows)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
