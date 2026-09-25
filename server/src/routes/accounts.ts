import type { Request, Response } from "express"

import { getPrisma } from "../lib/db"
import { sendError } from "../lib/http-error"

function toAccountJson(row: {
  id: string
  name: string
  status: string
  isDefault: boolean
  city: string | null
  postalCode: string | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    isDefault: row.isDefault,
    city: row.city,
    postalCode: row.postalCode,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function getDefaultAccount(_req: Request, res: Response) {
  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "Database is not configured.")
    return
  }

  const account = await prisma.account.findFirst({
    where: { isDefault: true },
  })

  if (!account) {
    sendError(res, 404, "NOT_FOUND", "Default account is not configured.")
    return
  }

  res.json({ account: toAccountJson(account) })
}
