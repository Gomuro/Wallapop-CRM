import type { Page } from "playwright"

import { throwIfPublishAborted } from "./busy"
import { log } from "../log"

/**
 * Dev pause on a live Chrome page. Drop `await inspectHold(page, "after_extra_fields")`
 * anywhere. Waits only when WALLAPOP_INSPECT_HOLD_MS > 0.
 * WALLAPOP_INSPECT_HOLD_AT=after_extra_fields,before_publicar — only those labels.
 * Empty AT = every call site.
 */
export function inspectHoldMs(): number {
  const raw =
    process.env.WALLAPOP_INSPECT_HOLD_MS?.trim() ||
    process.env.WALLAPOP_PUBLISH_HOLD_MS?.trim()
  if (!raw) return 0
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function holdAtAllows(label: string): boolean {
  const raw = process.env.WALLAPOP_INSPECT_HOLD_AT?.trim()
  if (!raw) return true
  const wanted = raw.split(",").map((part) => part.trim()).filter(Boolean)
  return wanted.includes(label)
}

export async function inspectHold(page: Page, label: string): Promise<void> {
  const ms = inspectHoldMs()
  if (ms <= 0 || !holdAtAllows(label)) return
  log("info", "wallapop_inspect_hold", { label, ms })
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    throwIfPublishAborted()
    const slice = Math.min(1_000, deadline - Date.now())
    if (slice <= 0) break
    await page.waitForTimeout(slice)
  }
}
