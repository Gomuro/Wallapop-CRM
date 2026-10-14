import { log, serializeError } from "./log"
import { isBrowserPublishBusy } from "./wallapop-cdp/busy"

export type WorkerJobKind = "sold" | "devolucion" | "eliminar"

type WorkerLane = "sold" | "listing"

export type WorkerJobView = {
  kind: WorkerJobKind | "publish"
  productId: string
  title: string
  state: "queued" | "running" | "done" | "failed"
  message: string | null
}

type WorkerJob = WorkerJobView & {
  id: string
  kind: WorkerJobKind
  run: (() => Promise<void>) | null
}

const FAILED_CAP = 5
const DONE_CAP = 5
const jobs: WorkerJob[] = []
const pumping: Record<WorkerLane, boolean> = {
  sold: false,
  listing: false,
}

function laneOf(kind: WorkerJobKind): WorkerLane {
  return kind === "sold" ? "sold" : "listing"
}

function trimState(state: "failed" | "done", cap: number) {
  const rows = jobs.filter((job) => job.state === state)
  for (const job of rows.slice(0, Math.max(0, rows.length - cap))) {
    drop(job.id)
  }
}

function drop(id: string) {
  const index = jobs.findIndex((job) => job.id === id)
  if (index >= 0) jobs.splice(index, 1)
}

async function pump(lane: WorkerLane) {
  if (pumping[lane]) return
  pumping[lane] = true
  try {
    for (;;) {
      const job = jobs.find(
        (row) => row.state === "queued" && laneOf(row.kind) === lane,
      )
      if (!job) break
      job.state = "running"
      try {
        await job.run?.()
        job.state = "done"
        job.run = null
        trimState("done", DONE_CAP)
      } catch (error) {
        job.state = "failed"
        job.run = null
        job.message = error instanceof Error ? error.message : "Error"
        trimState("failed", FAILED_CAP)
        log("error", "wallapop_worker_job_failed", {
          kind: job.kind,
          productId: job.productId,
          err: serializeError(error),
        })
      }
    }
  } finally {
    pumping[lane] = false
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
      (job.state === "queued" || job.state === "running"),
  )
  if (busy) {
    return { ok: false, message: "Este producto ya está en curso." }
  }
  for (const job of jobs.filter(
    (row) =>
      row.kind === input.kind &&
      row.productId === input.productId &&
      (row.state === "failed" || row.state === "done"),
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
  void pump(laneOf(input.kind))
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
  pumping.listing = false
}
