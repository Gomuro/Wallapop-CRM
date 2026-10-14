import { afterEach, describe, expect, it, vi } from "vitest"

import {
  enqueueWorkerJob,
  listWorkerJobs,
  resetWorkerJobsForTests,
} from "../src/lib/wallapop-worker-jobs"

describe("worker jobs", () => {
  afterEach(() => {
    resetWorkerJobsForTests()
  })

  it("runs a sale and a return together and queues a second sale", async () => {
    let releaseSold: () => void = () => {}
    const soldGate = new Promise<void>((resolve) => {
      releaseSold = resolve
    })
    const seen: string[] = []

    enqueueWorkerJob({
      kind: "sold",
      productId: "a",
      title: "A",
      run: async () => {
        seen.push("a-start")
        await soldGate
        seen.push("a-end")
      },
    })
    enqueueWorkerJob({
      kind: "sold",
      productId: "b",
      title: "B",
      run: async () => {
        seen.push("b")
      },
    })
    enqueueWorkerJob({
      kind: "devolucion",
      productId: "c",
      title: "C",
      run: async () => {
        seen.push("c")
      },
    })

    await vi.waitFor(() => {
      const rows = listWorkerJobs()
      expect(rows.find((job) => job.productId === "a")?.state).toBe("running")
      expect(rows.find((job) => job.productId === "b")?.state).toBe("queued")
      expect(rows.some((job) => job.productId === "c")).toBe(false)
    })

    const duplicate = enqueueWorkerJob({
      kind: "sold",
      productId: "a",
      title: "A",
      run: async () => {},
    })
    expect(duplicate.ok).toBe(false)

    releaseSold()
    await vi.waitFor(() => {
      expect(listWorkerJobs().some((job) => job.kind === "sold")).toBe(false)
    })
    expect(seen).toEqual(["a-start", "c", "a-end", "b"])
  })

  it("keeps a failed sale on the account list", async () => {
    enqueueWorkerJob({
      kind: "sold",
      productId: "d",
      title: "D",
      run: async () => {
        throw new Error("attach: no se encontró el botón")
      },
    })
    await vi.waitFor(() => {
      const row = listWorkerJobs().find((job) => job.productId === "d")
      expect(row?.state).toBe("failed")
      expect(row?.message).toBe("attach: no se encontró el botón")
    })
  })
})
