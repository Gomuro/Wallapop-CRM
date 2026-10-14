import { log, serializeError } from "./log"
import { isBrowserPublishBusy } from "./wallapop-cdp/busy"

export type WorkerJobKind = "sold" | "devolucion"

export type WorkerJobView = {
  kind: WorkerJobKind | "publish"
  productId: string
  title: string
  state: "queued" | "running" | "failed"
  message: string | null
}

type WorkerJob = WorkerJobView & {
  id: string
  kind: WorkerJobKind
  run: () => Promise<void>
}

const FAILED_CAP = 5
const jobs: WorkerJob[] = []
const pumping: Record<WorkerJobKind, boolean> = {
  sold: false,
  devolucion: false,
}

function trimFailed() {
  const failed = jobs.filter((job) => job.state === "failed")
  for (const job of failed.slice(0, Math.max(0, failed.length - FAILED_CAP))) {
    drop(job.id)
  }
}

function drop(id: string) {
  const index = jobs.findIndex((job) => job.id === id)
  if (index >= 0) jobs.splice(index, 1)
}

async function pump(kind: WorkerJobKind) {
  if (pumping[kind]) return
  pumping[kind] = true
  try {
    for (;;) {
      const job = jobs.find((row) => row.kind === kind && row.state === "queued")
      if (!job) break
      job.state = "running"
      try {
        await job.run()
        drop(job.id)
      } catch (error) {
        job.state = "failed"
        job.message = error instanceof Error ? error.message : "Error"
        trimFailed()
        log("error", "wallapop_worker_job_failed", {
          kind,
          productId: job.productId,
          err: serializeError(error),
        })
      }
    }
  } finally {
    pumping[kind] = false
  }
}

export function enqueueWorkerJob(input: {
  kind: WorkerJobKind
  productId: string
  title: string
  run: () => Promise<void>
}): { ok: true } | { ok: false; message: string } {
  const busy = jobs.some(
    (job) =>
      job.kind === input.kind &&
      job.productId === input.productId &&
      job.state !== "failed",
  )
  if (busy) {
    return { ok: false, message: "Este producto ya está en curso." }
  }
  for (const job of jobs.filter(
    (row) =>
      row.kind === input.kind &&
      row.productId === input.productId &&
      row.state === "failed",
  )) {
    drop(job.id)
  }
  jobs.push({
    id: `${input.kind}:${input.productId}:${Date.now()}`,
    kind: input.kind,
    productId: input.productId,
    title: input.title,
    state: "queued",
    message: null,
    run: input.run,
  })
  void pump(input.kind)
  return { ok: true }
}

export function listWorkerJobs(): WorkerJobView[] {
  const rows: WorkerJobView[] = jobs.map((job) => ({
    kind: job.kind,
    productId: job.productId,
    title: job.title,
    state: job.state,
    message: job.message,
  }))
  if (isBrowserPublishBusy()) {
    rows.unshift({
      kind: "publish",
      productId: "publish",
      title: "Anuncio",
      state: "running",
      message: null,
    })
  }
  return rows
}

export function resetWorkerJobsForTests() {
  jobs.splice(0, jobs.length)
  pumping.sold = false
  pumping.devolucion = false
}
