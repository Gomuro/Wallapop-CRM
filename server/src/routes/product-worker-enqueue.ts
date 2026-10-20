import type { Response } from "express"

import { sendError } from "../lib/http-error"
import { enqueueWorkerJob } from "../lib/wallapop-worker-jobs"

type JobKind = "sold" | "devolucion" | "eliminar"

export async function enqueueTitledJob(input: {
  res: Response
  prisma: {
    product: {
      findUnique: (args: {
        where: { id: string }
        select: { title: true }
      }) => Promise<{ title: string } | null>
    }
  }
  productId: string
  kind: JobKind
  run: () => Promise<void>
  payload?: Record<string, unknown>
}) {
  const titled = await input.prisma.product.findUnique({
    where: { id: input.productId },
    select: { title: true },
  })
  const queued = enqueueWorkerJob({
    kind: input.kind,
    productId: input.productId,
    title: titled?.title ?? "Producto",
    run: input.run,
  })
  if (!queued.ok) {
    sendError(input.res, 409, "ALREADY_QUEUED", queued.message)
    return
  }
  input.res.json({
    ok: true,
    queued: true,
    dryRun: false,
    step: "queued",
    product: null,
    error: null,
    ...input.payload,
  })
}
