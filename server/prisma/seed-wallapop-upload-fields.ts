import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import type { Prisma } from "../generated/prisma/client"
import type { CategoryUploadField } from "../../lib/inventory/category-upload-fields"
import type { UploadFieldsSnapshot } from "./wallapop-upload-components"

const SNAPSHOT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "data",
  "wallapop-upload-fields.json",
)

type UploadFieldsSeedClient = {
  category: {
    findMany: (args: {
      select: { id: true; wallapopId: true; attributes: true }
    }) => Promise<
      Array<{ id: string; wallapopId: number; attributes: unknown }>
    >
    update: (args: {
      where: { id: string }
      data: { attributes: Prisma.InputJsonValue }
    }) => Promise<unknown>
  }
}

export function loadUploadFieldsSnapshot(): UploadFieldsSnapshot | null {
  if (!existsSync(SNAPSHOT_PATH)) return null
  return JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as UploadFieldsSnapshot
}

function mergeAttributes(
  existing: unknown,
  uploadFields: CategoryUploadField[],
): Prisma.InputJsonValue {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {}
  return { ...base, uploadFields } as Prisma.InputJsonValue
}

export async function seedWallapopUploadFields(prisma: UploadFieldsSeedClient) {
  const snapshot = loadUploadFieldsSnapshot()
  if (!snapshot?.catalogs?.length) {
    console.log("upload-fields snapshot missing, skip")
    return
  }

  const fieldsByLeaf = new Map<number, CategoryUploadField[]>()
  for (const catalog of snapshot.catalogs) {
    for (const leaf of catalog.leafWallapopIds) {
      fieldsByLeaf.set(leaf, catalog.fields)
    }
  }

  const categories = await prisma.category.findMany({
    select: { id: true, wallapopId: true, attributes: true },
  })
  let updated = 0
  for (const row of categories) {
    const fields = fieldsByLeaf.get(row.wallapopId)
    if (!fields) continue
    await prisma.category.update({
      where: { id: row.id },
      data: { attributes: mergeAttributes(row.attributes, fields) },
    })
    updated += 1
  }
  console.log(
    `uploadFields catalogs=${snapshot.catalogs.length} categories=${updated}`,
  )
}

async function runIfDirect() {
  const invoked = process.argv[1]?.replace(/\\/g, "/") ?? ""
  if (!invoked.endsWith("seed-wallapop-upload-fields.ts")) return
  const { config } = await import("dotenv")
  const { existsSync } = await import("node:fs")
  const { resolve } = await import("node:path")
  const fromRoot = resolve(process.cwd(), "server/.env")
  config({ path: existsSync(fromRoot) ? fromRoot : resolve(process.cwd(), ".env") })
  const { getPrisma } = await import("../src/lib/db")
  const prisma = getPrisma()
  if (!prisma) throw new Error("DATABASE_URL is not set")
  await seedWallapopUploadFields(prisma)
  await prisma.$disconnect()
}

void runIfDirect()
