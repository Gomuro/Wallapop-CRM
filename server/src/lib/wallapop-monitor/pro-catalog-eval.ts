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
    if (href) rows.push({ href, reserved, sold })
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
