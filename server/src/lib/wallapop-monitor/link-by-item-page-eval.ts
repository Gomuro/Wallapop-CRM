export const ITEM_PAGE_FACTS_EVAL = `(() => {
  function og(prop) {
    const el = document.querySelector('meta[property="' + prop + '"]')
    return el ? String(el.getAttribute("content") || "").trim() : ""
  }
  function named(name) {
    const el = document.querySelector('meta[name="' + name + '"]')
    return el ? String(el.getAttribute("content") || "").trim() : ""
  }
  let jsonTitle = ""
  let jsonDesc = ""
  let jsonPrice = ""
  document.querySelectorAll('script[type="application/ld+json"]').forEach((node) => {
    try {
      const parsed = JSON.parse(node.textContent || "")
      const nodes = Array.isArray(parsed) ? parsed : [parsed]
      for (const row of nodes) {
        if (!row || typeof row !== "object") continue
        const type = row["@type"]
        const isProduct =
          type === "Product" ||
          (Array.isArray(type) && type.includes("Product"))
        if (!isProduct) continue
        if (row.name) jsonTitle = String(row.name)
        if (row.description) jsonDesc = String(row.description)
        const offers = row.offers
        const offer = Array.isArray(offers) ? offers[0] : offers
        if (offer && offer.price != null) jsonPrice = String(offer.price)
      }
    } catch (e) {}
  })
  const h1 = document.querySelector("h1")
  const h1Text = h1
    ? String(h1.textContent || "").replace(/\\s+/g, " ").trim()
    : ""
  return {
    href: String(location.href || ""),
    title: jsonTitle || og("og:title") || h1Text,
    description: jsonDesc || og("og:description") || named("description"),
    priceText: jsonPrice || og("product:price:amount") || og("og:price:amount"),
  }
})()`
