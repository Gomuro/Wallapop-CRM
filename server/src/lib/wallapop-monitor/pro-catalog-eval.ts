export function parseProPager(
  text: string,
): { from: number; to: number; total: number } | null {
  const match = text
    .replace(/\s+/g, " ")
    .trim()
    .match(/(\d+)\s*-\s*(\d+)\s*de\s*(\d+)/i)
  if (!match) return null
  return {
    from: Number(match[1]),
    to: Number(match[2]),
    total: Number(match[3]),
  }
}

export const PAGE_KIND_EVAL = `(() => {
  const activo = [...document.querySelectorAll("wallapop-tab")].find((el) =>
    (el.getAttribute("aria-label") || "").startsWith("Activos"),
  )
  if (activo) return "pro"
  if (document.querySelector("tsl-catalog-item")) return "classic"
  return "unknown"
})()`

/** Pro table row. A sale is only `badgetype="sold"`, the same badge as the classic Vendidos list. */
export const PRO_CATALOG_ROWS_EVAL = `(() => {
  function walk(root, visit) {
    if (!root || !root.querySelectorAll) return
    root.querySelectorAll("*").forEach((el) => {
      visit(el)
      if (el.shadowRoot) walk(el.shadowRoot, visit)
    })
  }
  function text(el) {
    return String(el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim()
  }
  const rows = []
  document.querySelectorAll('tr[id^="CatalogItem_"]').forEach((row) => {
    let href = ""
    let reserved = false
    let sold = false
    walk(row, (node) => {
      if (
        !href &&
        node.tagName === "A" &&
        String(node.href || "").includes("/item/")
      ) {
        href = String(node.href)
      }
      if (node.tagName !== "WALLAPOP-BADGE") return
      const kind = node.getAttribute("badgetype")
      if (kind === "reserved") reserved = true
      if (kind === "sold") sold = true
    })
    if (!href) return
    const titleEl = row.querySelector("span.Title")
    let title = titleEl
      ? String(titleEl.textContent || titleEl.innerText || "").replace(/\\s+/g, " ").trim()
      : ""
    const bits = []
    row.querySelectorAll("td").forEach((td) => {
      const value = text(td)
      if (value) bits.push(value)
    })
    const priceText =
      bits.find((value) => /€/.test(value) && value !== title && !value.startsWith(title)) ||
      bits.find((value) => /€/.test(value)) ||
      ""
    if (!title) {
      title =
        bits.find(
          (value) =>
            value !== priceText &&
            !/^\\d{1,2}\\/\\d{1,2}\\/\\d{4}/.test(value) &&
            !/^\\d+$/.test(value),
        ) || ""
    }
    rows.push({ href, reserved, sold, title, priceText })
  })
  const info = document.querySelector(
    "tsl-pagination-actions .PaginationActions__info",
  )
  return {
    rows,
    pager: info ? String(info.textContent || "").replace(/\\s+/g, " ").trim() : "",
  }
})()`

export function clickTabEval(prefix: string): string {
  return `(() => {
    const prefix = ${JSON.stringify(prefix.toLowerCase())}
    const tab = [...document.querySelectorAll("wallapop-tab")].find((el) =>
      (el.getAttribute("aria-label") || "").toLowerCase().startsWith(prefix),
    )
    if (!tab) return false
    tab.click()
    return true
  })()`
}

export const CLICK_NEXT_EVAL = `(() => {
  const host = document.querySelector("tsl-pagination-actions")
  if (!host) return false
  const icons = [...host.querySelectorAll("walla-icon.PaginationActions__action")]
  const next = icons[icons.length - 1]
  if (!next || next.classList.contains("PaginationActions__action--disabled")) {
    return false
  }
  next.click()
  return true
})()`

/** First pager icon is the previous page. A lone Next icon is not a previous control. */
export const CLICK_PREV_EVAL = `(() => {
  const host = document.querySelector("tsl-pagination-actions")
  if (!host) return false
  const info = host.querySelector(".PaginationActions__info")
  const text = (info && info.textContent ? info.textContent : "").replace(/\\s+/g, " ").trim()
  const match = text.match(/(\\d+)\\s*-\\s*(\\d+)\\s*de\\s*(\\d+)/i)
  if (!match || Number(match[1]) <= 1) return false
  const icons = [...host.querySelectorAll("walla-icon.PaginationActions__action")]
  if (icons.length < 2) return false
  const prev = icons[0]
  if (!prev || prev.classList.contains("PaginationActions__action--disabled")) return false
  prev.click()
  return true
})()`

export function listedPageReadyEval(input: {
  tab?: string
  previousPager?: string
  previousHref?: string
}): string {
  return `(() => {
    const input = ${JSON.stringify(input)}
    if (input.tab) {
      const tab = [...document.querySelectorAll("wallapop-tab")].find((el) =>
        (el.getAttribute("aria-label") || "")
          .toLowerCase()
          .startsWith(input.tab || ""),
      )
      if (!tab || tab.getAttribute("aria-selected") !== "true") return false
    }
    const info = document.querySelector(
      "tsl-pagination-actions .PaginationActions__info",
    )
    const text = (info && info.textContent ? info.textContent : "").replace(/\\s+/g, " ").trim()
    const match = text.match(/(\\d+)\\s*-\\s*(\\d+)\\s*de\\s*(\\d+)/i)
    if (!match) return false
    const from = Number(match[1])
    const to = Number(match[2])
    const total = Number(match[3])
    const rows = document.querySelectorAll('tr[id^="CatalogItem_"]').length
    if (total === 0) return rows === 0
    if (rows !== to - from + 1) return false
    if (input.previousPager && text === input.previousPager) return false
    const first = document.querySelector('tr[id^="CatalogItem_"] a[href*="/item/"]')
    if (input.previousHref && first instanceof HTMLAnchorElement) {
      return first.href !== input.previousHref
    }
    return true
  })()`
}

/** True once the first catalog row is not the one shown before Next. */
export function firstRowChangedEval(previousHref: string | undefined): string {
  return `(() => {
    const first = document.querySelector('tr[id^="CatalogItem_"] a[href*="/item/"]')
    return first instanceof HTMLAnchorElement && first.href !== ${JSON.stringify(previousHref ?? "")}
  })()`
}
