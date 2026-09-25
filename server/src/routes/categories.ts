import type { Request, Response } from "express"

import { getPrisma } from "../lib/db"
import { sendError } from "../lib/http-error"

const categorySelect = {
  id: true,
  wallapopId: true,
  parentId: true,
  slug: true,
  nameEs: true,
  nameUk: true,
  isLeaf: true,
  leafSelectionMandatory: true,
  depth: true,
  path: true,
  sortOrder: true,
} as const

function toCategoryJson(row: {
  id: string
  wallapopId: number
  parentId: string | null
  slug: string
  nameEs: string
  nameUk: string
  isLeaf: boolean
  leafSelectionMandatory: boolean
  depth: number
  path: string
  sortOrder: number
}) {
  return {
    id: row.id,
    wallapopId: row.wallapopId,
    parentId: row.parentId,
    slug: row.slug,
    nameEs: row.nameEs,
    nameUk: row.nameUk,
    isLeaf: row.isLeaf,
    leafSelectionMandatory: row.leafSelectionMandatory,
    depth: row.depth,
    path: row.path,
    sortOrder: row.sortOrder,
  }
}

function paramId(req: Request) {
  const id = req.params.id
  return typeof id === "string" ? id : Array.isArray(id) ? id[0] : ""
}

export async function listCategories(req: Request, res: Response) {
  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "Database is not configured.")
    return
  }

  const parentId =
    typeof req.query.parentId === "string" ? req.query.parentId.trim() : ""

  const rows = await prisma.category.findMany({
    where:
      parentId === ""
        ? undefined
        : parentId === "root"
          ? { parentId: null }
          : { parentId },
    select: categorySelect,
    orderBy: [
      { parentId: { sort: "asc", nulls: "first" } },
      { sortOrder: "asc" },
    ],
  })

  res.json({ categories: rows.map(toCategoryJson) })
}

export async function getCategory(req: Request, res: Response) {
  const id = paramId(req)
  if (!id) {
    sendError(res, 404, "NOT_FOUND", "Category not found.")
    return
  }

  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "Database is not configured.")
    return
  }

  const row = await prisma.category.findUnique({
    where: { id },
    select: categorySelect,
  })
  if (!row) {
    sendError(res, 404, "NOT_FOUND", "Category not found.")
    return
  }

  res.json({ category: toCategoryJson(row) })
}
