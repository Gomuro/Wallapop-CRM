import type { Page } from "playwright"

import { isNavigationError } from "./click"

/**
 * What the tab shows after "Marcar como vendido" (VPS 2026-11-03):
 * - "confirm": the old dialog with `walla-button#markAsSoldButton` (item without chats);
 * - "outside": "Selecciona a quién lo vendiste" with buyers from the chats and the link
 *   "Lo vendí fuera de Wallapop" (item with chats). Only that link is clicked, never a buyer;
 * - "buyers": the buyer list without that link;
 * - "modal": a sold modal with none of these yet;
 * - "none": no sold modal on the tab.
 */
export type SoldStepView = "confirm" | "outside" | "buyers" | "modal" | "none"

const OUTSIDE_TEXT = "lo vendi fuera de wallapop"
const BUYERS_TEXT = "selecciona a quien lo vendiste"

function soldStepEval(click: boolean): string {
  return `(() => {
  const click = ${JSON.stringify(click)}
  const norm = (value) => String(value || "").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "")
    .replace(/\\s+/g, " ").trim().toLowerCase()
  function walk(root, visit) {
    if (!root || !root.querySelectorAll) return
    root.querySelectorAll("*").forEach((el) => {
      visit(el)
      if (el.shadowRoot) walk(el.shadowRoot, visit)
    })
  }
  if (document.querySelector("walla-button#markAsSoldButton")) return "confirm"
  const roots = [...document.querySelectorAll("tsl-sold-modal, ngb-modal-window, [role=dialog]")]
  if (roots.length === 0) return "none"
  const CLICKABLE = new Set(["A", "BUTTON", "WALLA-BUTTON"])
  let link = null
  let fallback = null
  let buyers = false
  for (const root of roots) {
    walk(root, (el) => {
      const own = norm(el.getAttribute("text") || el.textContent)
      if (own === ${JSON.stringify(BUYERS_TEXT)}) buyers = true
      if (own !== ${JSON.stringify(OUTSIDE_TEXT)}) return
      if (!link && (CLICKABLE.has(el.tagName) || el.getAttribute("role") === "button")) link = el
      fallback = el
    })
  }
  const target = link || fallback
  if (!target) return buyers ? "buyers" : "modal"
  if (click) {
    const inner = target.shadowRoot && target.shadowRoot.querySelector("button, a")
    ;(inner || target).click()
  }
  return "outside"
})()`
}

export const READ_SOLD_STEP_EVAL = soldStepEval(false)
export const CLICK_SOLD_OUTSIDE_EVAL = soldStepEval(true)

/** Reads the step; with `clickOutside` it also clicks "Lo vendí fuera de Wallapop" when shown. */
export async function readSoldStep(page: Page, clickOutside = false): Promise<SoldStepView> {
  if (page.isClosed()) return "none"
  try {
    return (await page.evaluate(clickOutside ? CLICK_SOLD_OUTSIDE_EVAL : READ_SOLD_STEP_EVAL)) as SoldStepView
  } catch (error) {
    if (isNavigationError(error)) return "modal"
    throw error
  }
}
