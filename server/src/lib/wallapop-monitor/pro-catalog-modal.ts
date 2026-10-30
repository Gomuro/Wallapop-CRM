import path from "node:path"

import type { Page } from "playwright"

import { log } from "../log"

const MODAL_TEXT = "rediseñado"
const SKIP_TEXT = "Saltar"
const HTML_CAP = 30_000
const GONE_WAIT_MS = 5_000

type ModalShot =
  | { state: "none" }
  | { state: "unmatched"; html: string }
  | { state: "found" | "clicked"; html: string }

let firstCloseLogged = false
let unmatchedLogged = false

/** Page-side helpers for proModalEval: shadow DOM walk, deep text, dialog and button tests. */
const MODAL_DOM_HELPERS = `
    function walk(root, visit) {
      if (!root || !root.querySelectorAll) return
      root.querySelectorAll("*").forEach((el) => {
        visit(el)
        if (el.shadowRoot) walk(el.shadowRoot, visit)
      })
    }
    function deepText(el) {
      let out = el.textContent || ""
      if (el.shadowRoot) out += " " + deepText(el.shadowRoot)
      walk(el, (node) => {
        if (node.shadowRoot) out += " " + (node.shadowRoot.textContent || "")
      })
      return out.replace(/\\s+/g, " ").trim()
    }
    function isWindow(el) {
      const tag = el.tagName.toLowerCase()
      const role = (el.getAttribute("role") || "").toLowerCase()
      const cls = String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || "").toLowerCase()
      return tag === "dialog" || role === "dialog" || role === "alertdialog" ||
        el.getAttribute("aria-modal") === "true" ||
        tag.includes("modal") || tag.includes("dialog") ||
        cls.includes("modal") || cls.includes("dialog")
    }
    function isButton(el) {
      const tag = el.tagName.toLowerCase()
      return tag === "button" || tag === "a" || tag.includes("button") ||
        (el.getAttribute("role") || "").toLowerCase() === "button"
    }
    function walkInside(el, visit) {
      if (el.shadowRoot) walk(el.shadowRoot, visit)
      walk(el, visit)
    }
    function visible(el) {
      return el.getClientRects().length > 0
    }
`

/**
 * "Se ha rediseñado el catálogo Pro". Clicks only a visible button whose text is exactly
 * "Saltar", and only inside a dialog-like element whose text has "rediseñado".
 * No such dialog: nothing is clicked.
 */
function proModalEval(click: boolean): string {
  return `(() => {
    const click = ${JSON.stringify(click)}
    const needle = ${JSON.stringify(MODAL_TEXT)}
    const skip = ${JSON.stringify(SKIP_TEXT)}
    const cap = ${HTML_CAP}
    ${MODAL_DOM_HELPERS}
    const windows = []
    let textHost = null
    walk(document, (el) => {
      el.childNodes.forEach((node) => {
        if (node.nodeType === 3 && String(node.textContent).toLowerCase().includes(needle)) textHost = el
      })
    })
    if (!textHost) return { state: "none" }
    walk(document, (el) => {
      if (!isWindow(el)) return
      const text = deepText(el)
      if (text.toLowerCase().includes(needle)) windows.push({ el, size: text.length })
    })
    windows.sort((a, b) => a.size - b.size)
    for (const win of windows) {
      let button = null
      walkInside(win.el, (el) => {
        if (isButton(el) && visible(el) && deepText(el) === skip) button = el
      })
      if (!button) continue
      const html = String(win.el.outerHTML || "").slice(0, cap)
      if (!click) return { state: "found", html }
      button.click()
      return { state: "clicked", html }
    }
    let around = textHost
    for (let i = 0; i < 3 && around.parentElement; i += 1) around = around.parentElement
    return { state: "unmatched", html: String(around.outerHTML || "").slice(0, cap) }
  })()`
}

async function saveShot(page: Page, shotDir: string): Promise<string | null> {
  const file = path.join(shotDir, `pro-modal-${Date.now()}.png`)
  try {
    await page.screenshot({ path: file, timeout: 10_000 })
    return file
  } catch {
    return null
  }
}

async function logUnmatched(page: Page, where: string, html: string, shotDir: string) {
  if (unmatchedLogged) return
  unmatchedLogged = true
  log("warn", "wallapop_monitor_pro_modal_unmatched", {
    where,
    html,
    screenshot: await saveShot(page, shotDir),
  })
}

/** Closes the Pro catalog redesign modal if it is open. Never throws. True when "Saltar" was clicked. */
export async function closeProCatalogModal(
  page: Page,
  where: string,
  shotDir = path.resolve(process.cwd(), "server", "logs"),
): Promise<boolean> {
  try {
    const found = (await page.evaluate(proModalEval(false))) as ModalShot
    if (found.state === "none") return false
    if (found.state === "unmatched") {
      await logUnmatched(page, where, found.html, shotDir)
      return false
    }
    const first = !firstCloseLogged
    const screenshot = first ? await saveShot(page, shotDir) : null
    const clicked = (await page.evaluate(proModalEval(true))) as ModalShot
    if (clicked.state !== "clicked") return false
    firstCloseLogged = true
    await page
      .waitForFunction(`(${proModalEval(false)}).state !== "found"`, undefined, {
        timeout: GONE_WAIT_MS,
      })
      .catch(() => {})
    log("info", "wallapop_monitor_pro_modal_closed", {
      where,
      ...(first ? { html: found.html, screenshot } : {}),
    })
    return true
  } catch (error) {
    log("warn", "wallapop_monitor_pro_modal_error", {
      where,
      message: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}
