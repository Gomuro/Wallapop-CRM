import { beforeEach, describe, expect, it, vi } from "vitest"

const spies = vi.hoisted(() => ({
  logs: [] as Array<{ level: string; msg: string; data?: Record<string, unknown> }>,
}))

vi.mock("../src/lib/log", async (original) => ({
  ...(await original<typeof import("../src/lib/log")>()),
  log: (level: string, msg: string, data?: Record<string, unknown>) => {
    spies.logs.push({ level, msg, data })
  },
}))

import type { Page } from "playwright"

import { ensurePackageSizeIfShown } from "../src/lib/wallapop-publish/shipping"

/**
 * Virtual clock: the form only sees the time its own waits add up to.
 * `radiosAtMs` / `bandsAtMs`: when Estándar-Voluminoso / kg bands appear (null = never).
 */
function fakeForm(opts: { radiosAtMs: number | null; bandsAtMs: number | null }) {
  let clock = 0
  let checked: string | null = null
  const clicks: string[] = []
  const radiosShown = () => opts.radiosAtMs != null && clock >= opts.radiosAtMs
  const bandsShown = () => opts.bandsAtMs != null && clock >= opts.bandsAtMs
  const radio = (name: string) => ({
    count: async () => (radiosShown() ? 1 : 0),
    isVisible: async () => radiosShown(),
    isChecked: async () => checked === name,
    waitFor: async () => {
      if (!radiosShown()) throw new Error("radio not visible")
    },
    scrollIntoViewIfNeeded: async () => {},
    click: async () => {
      checked = name
      clicks.push(name)
    },
  })
  const page = {
    waitForTimeout: async (ms: number) => {
      clock += ms
    },
    getByRole: (_role: string, { name }: { name: string }) => ({ first: () => radio(name) }),
    getByText: () => ({ first: () => ({ isVisible: async () => false }) }),
    evaluate: async () => (bandsShown() ? ["2 a 5 kg", "5 a 10 kg", "10 a 20 kg"] : []),
  }
  return { page: page as unknown as Page, clicks, elapsed: () => clock }
}

const msgs = () => spies.logs.map((entry) => entry.msg)

describe("package size before the weight band", () => {
  beforeEach(() => {
    spies.logs.length = 0
  })

  it("W2 Gardena 31.10: radios appear at 4 s -> Estándar is picked", async () => {
    const form = fakeForm({ radiosAtMs: 4_000, bandsAtMs: null })
    await ensurePackageSizeIfShown(form.page, "STANDARD")
    expect(form.clicks).toEqual(["delivery"])
    expect(msgs()).toContain("wallapop_publish_package_size_selected")
    expect(msgs()).not.toContain("wallapop_publish_package_size_absent")
    expect(form.elapsed()).toBe(4_000 + 800)
  })

  it("radios already there -> picked with no extra wait", async () => {
    const form = fakeForm({ radiosAtMs: 0, bandsAtMs: null })
    await ensurePackageSizeIfShown(form.page, "BULKY")
    expect(form.clicks).toEqual(["bulky"])
    expect(form.elapsed()).toBe(800)
  })

  it("Pro: kg bands at once -> leaves on the first check, clicks nothing", async () => {
    const form = fakeForm({ radiosAtMs: null, bandsAtMs: 0 })
    await ensurePackageSizeIfShown(form.page, "STANDARD")
    expect(form.clicks).toEqual([])
    expect(form.elapsed()).toBe(0)
    expect(spies.logs).toContainEqual({
      level: "info",
      msg: "wallapop_publish_package_size_absent",
      data: { packageType: "STANDARD", weightShown: true, waitedMs: 0 },
    })
  })

  it("nothing appears -> gives up at 15 s and goes on as before", async () => {
    const form = fakeForm({ radiosAtMs: null, bandsAtMs: null })
    await ensurePackageSizeIfShown(form.page, "STANDARD")
    expect(form.clicks).toEqual([])
    expect(form.elapsed()).toBe(15_000)
    expect(spies.logs).toContainEqual({
      level: "info",
      msg: "wallapop_publish_package_size_absent",
      data: { packageType: "STANDARD", weightShown: false, waitedMs: 15_000 },
    })
  })
})
