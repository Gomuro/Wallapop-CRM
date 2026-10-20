import type { Page } from "playwright"

import { log } from "../log"

const CATALOG_SWITCH_WAIT_MS = 15_000
const TODO_CATALOG_LABEL = "todo el catálogo"

type CatalogChoice = {
  hasSwitcher: boolean
  label: string
  selected: string
}

function isFullCatalogUrl(url: string): boolean {
  try {
    return new URL(url).pathname.replace(/\/$/, "") === "/app/catalog/management"
  } catch {
    return false
  }
}

function choiceIsTodo(choice: CatalogChoice, url: string): boolean {
  const blob = `${choice.label} ${choice.selected}`.toLowerCase()
  return blob.includes(TODO_CATALOG_LABEL) && isFullCatalogUrl(url)
}

const READ_CATALOG_CHOICE_EVAL = `(() => {
  function walk(root, visit) {
    if (!root || !root.querySelectorAll) return
    root.querySelectorAll("*").forEach((el) => {
      visit(el)
      if (el.shadowRoot) walk(el.shadowRoot, visit)
    })
  }
  function textOf(el) {
    let text = ""
    walk(el, (node) => {
      if (text || !node.childNodes) return
      node.childNodes.forEach((child) => {
        if (child.nodeType === 3 && String(child.textContent || "").trim()) {
          text = String(child.textContent).trim()
        }
      })
    })
    return text || String(el.textContent || "").replace(/\\s+/g, " ").trim()
  }
  const button = document.querySelector('[aria-label^="Catálogo seleccionado"]')
  let selected = ""
  walk(document, (el) => {
    if (selected || el.tagName !== "WALLA-DROPDOWN-ITEM") return
    if (el.getAttribute("aria-selected") !== "true") return
    selected = textOf(el)
  })
  return {
    hasSwitcher: Boolean(button),
    label: button ? button.getAttribute("aria-label") || "" : "",
    selected,
  }
})()`

const CLICK_TODO_CATALOG_EVAL = `(() => {
  const wanted = ${JSON.stringify(TODO_CATALOG_LABEL)}
  function walk(root, visit) {
    if (!root || !root.querySelectorAll) return
    root.querySelectorAll("*").forEach((el) => {
      visit(el)
      if (el.shadowRoot) walk(el.shadowRoot, visit)
    })
  }
  function textOf(el) {
    let text = ""
    walk(el, (node) => {
      if (text || !node.childNodes) return
      node.childNodes.forEach((child) => {
        if (child.nodeType === 3 && String(child.textContent || "").trim()) {
          text = String(child.textContent).trim()
        }
      })
    })
    return text || String(el.textContent || "").replace(/\\s+/g, " ").trim()
  }
  const button = document.querySelector('[aria-label^="Catálogo seleccionado"]')
  if (button && button.getAttribute("aria-expanded") !== "true") button.click()
  let target = null
  walk(document, (el) => {
    if (target || el.tagName !== "WALLA-DROPDOWN-ITEM") return
    if (textOf(el).toLowerCase() !== wanted) return
    target = el
  })
  if (!target) return "missing"
  target.click()
  return "clicked"
})()`

const TODO_SELECTED_EVAL = `(() => {
  const path = location.pathname.replace(/\\/$/, "")
  if (path !== "/app/catalog/management") return false
  const button = document.querySelector('[aria-label^="Catálogo seleccionado"]')
  const label = button ? button.getAttribute("aria-label") || "" : ""
  return label.toLowerCase().includes(${JSON.stringify(TODO_CATALOG_LABEL)})
})()`

async function readCatalogChoice(page: Page): Promise<CatalogChoice> {
  return (await page.evaluate(READ_CATALOG_CHOICE_EVAL)) as CatalogChoice
}

async function clickTodoCatalogItem(
  page: Page,
): Promise<"clicked" | "missing"> {
  return (await page.evaluate(CLICK_TODO_CATALOG_EVAL)) as "clicked" | "missing"
}

function logNoCatalogSwitcher(page: Page, ok: boolean): void {
  log("info", "wallapop_monitor_catalog_switch", {
    skipped: true,
    reason: "no_switcher",
    url: page.url(),
    ok,
  })
}

function logCatalogAlreadyTodo(page: Page, label: string): void {
  log("info", "wallapop_monitor_catalog_switch", {
    already: true,
    label,
    url: page.url(),
  })
}

async function clickTodoUntilFound(page: Page): Promise<"clicked" | "missing"> {
  let result: "clicked" | "missing" = "missing"
  for (let attempt = 0; attempt < 3 && result === "missing"; attempt += 1) {
    result = await clickTodoCatalogItem(page)
    if (result === "missing") await page.waitForTimeout(400)
  }
  return result
}

async function waitForTodoCatalog(page: Page): Promise<boolean> {
  try {
    await page.waitForFunction(TODO_SELECTED_EVAL, {
      timeout: CATALOG_SWITCH_WAIT_MS,
    })
    return true
  } catch {
    return false
  }
}

function logCatalogSwitchFailed(
  page: Page,
  before: CatalogChoice,
  result: "clicked" | "missing",
  after: CatalogChoice,
): void {
  log("warn", "wallapop_monitor_catalog_switch_failed", {
    result,
    from: before.label,
    label: after.label,
    url: page.url(),
  })
}

/**
 * Pro accounts keep two lists. The trigger is the light-DOM
 * `[aria-label^="Catálogo seleccionado"]` (`div.walla-dropdown__inner-input`).
 * Options are `walla-dropdown-item` inside that dropdown, including shadow.
 * "Suscripción Multicategoría" is consumer goods only. "Todo el catálogo" is
 * the full list. The selected value sticks, so opening `/catalog/management`
 * still lands on `/consumergoods` until this item is clicked.
 */
export async function ensureTodoElCatalogo(page: Page): Promise<boolean> {
  const before = await readCatalogChoice(page)
  if (!before.hasSwitcher) {
    const ok = isFullCatalogUrl(page.url())
    logNoCatalogSwitcher(page, ok)
    return ok
  }
  if (choiceIsTodo(before, page.url())) {
    logCatalogAlreadyTodo(page, before.label)
    return true
  }

  const result = await clickTodoUntilFound(page)
  if (await waitForTodoCatalog(page)) {
    log("info", "wallapop_monitor_catalog_switch", {
      from: before.label,
      url: page.url(),
    })
    return true
  }

  const after = await readCatalogChoice(page)
  logCatalogSwitchFailed(page, before, result, after)
  return false
}
