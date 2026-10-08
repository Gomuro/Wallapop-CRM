import type { Request, Response } from "express"

import { getPrisma } from "../lib/db"
import { sendError } from "../lib/http-error"

const BRAND_LIMIT = 40

export async function listBrands(req: Request, res: Response) {
  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "Database is not configured.")
    return
  }

  const categoryId =
    typeof req.query.categoryId === "string" ? req.query.categoryId.trim() : ""
  const q = typeof req.query.q === "string" ? req.query.q.trim() : ""

  if (categoryId === "") {
    res.json({ brands: [] })
    return
  }

  const rows = await prisma.brand.findMany({
    where: {
      AND: [
        { categories: { some: { categoryId } } },
        q === ""
          ? {}
          : { name: { startsWith: q, mode: "insensitive" } },
      ],
    },
    select: { name: true },
    orderBy: { name: "asc" },
    take: BRAND_LIMIT,
  })

  res.json({ brands: rows.map((row) => row.name) })
}
