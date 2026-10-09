export const CATALOG_PUBLISHED_URL =
  "https://es.wallapop.com/app/catalog/published"
export const CATALOG_SOLD_URL = "https://es.wallapop.com/app/catalog/sold"

export type PublishedCatalogRow = {
  href: string
  reserved: boolean
}

/**
 * En venta rows. Reserved = host `wallapop-badge[badgetype=reserved]` in light
 * or open shadow. Never `button.btn-reserve`.
 */
export const PUBLISHED_CATALOG_ROWS_EVAL = `(() => {
  function collect(root, into) {
    if (!root || !root.querySelectorAll) return
    root.querySelectorAll("*").forEach((el) => {
      into.push(el)
      if (el.shadowRoot) collect(el.shadowRoot, into)
    })
  }
  const rows = []
  document.querySelectorAll("tsl-catalog-item").forEach((host) => {
    const nodes = [host]
    collect(host, nodes)
    if (host.shadowRoot) collect(host.shadowRoot, nodes)
    const link = nodes.find(
      (n) =>
        n.tagName === "A" &&
        n.href &&
        String(n.href).includes("/item/"),
    )
    const badge = nodes.find((n) => {
      if (n.tagName !== "WALLAPOP-BADGE") return false
      return n.getAttribute("badgetype") === "reserved"
    })
    rows.push({
      href: link && link.href ? String(link.href) : "",
      reserved: Boolean(badge),
    })
  })
  return rows
})()`
