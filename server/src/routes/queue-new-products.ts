import type { Request, Response } from "express"
import { z, ZodError } from "zod"

import { getPrisma } from "../lib/db"
import { sendError } from "../lib/http-error"
import {
  readQueueNewProductAllAccounts,
  writeQueueNewProductAllAccounts,
} from "../lib/queue-new-products"

const bodySchema = z.object({ enabled: z.boolean() })

export async function getQueueNewProducts(_req: Request, res: Response) {
  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "Database is not configured.")
    return
  }
  const enabled = await readQueueNewProductAllAccounts(prisma)
  res.json({ enabled })
}

export async function putQueueNewProducts(req: Request, res: Response) {
  const prisma = getPrisma()
  if (!prisma) {
    sendError(res, 500, "INTERNAL", "Database is not configured.")
    return
  }
  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(req.body)
  } catch (error) {
    if (error instanceof ZodError) {
      sendError(res, 400, "VALIDATION", "enabled must be true or false.")
      return
    }
    throw error
  }
  const enabled = await writeQueueNewProductAllAccounts(prisma, body.enabled)
  res.json({ enabled })
}
