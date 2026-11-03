import { chromium, type Page } from "playwright"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { scrapeProCatalogs } from "../src/lib/wallapop-monitor/pro-catalog"

const URL_TODO = "https://catalog.test/app/catalog/management"

/**
 * A small Pro catalog: a «Catálogo seleccionado» switcher, three tabs, one page
 * per tab. Under Multicategoría, Vendidos hides the motor sale (like Barras).
 * `resetOnTab`: clicking a tab brings the remembered Multicategoría back.
 */
function proCatalogHtml(opts: { resetOnTab: boolean; todoMissing: boolean }): string {
  return `<body>
  <div class="walla-dropdown__inner-input" id="switch" aria-label="Catálogo seleccionado, Todo el catálogo"></div>
  <div id="items"></div>
  <wallapop-tab aria-label="Activos (3)" aria-selected="true"></wallapop-tab>
  <wallapop-tab aria-label="Vendidos (2)" aria-selected="false"></wallapop-tab>
  <wallapop-tab aria-label="Inactivos (0)" aria-selected="false"></wallapop-tab>
  <table id="rows"></table>
  <tsl-pagination-actions><span class="PaginationActions__info" id="pager"></span></tsl-pagination-actions>
  <script>
    const DATA = {
      Activos: { todo: ["/item/olla-1", "/item/silla-4", "/item/mesa-5"], multi: ["/item/olla-1", "/item/silla-4", "/item/mesa-5"] },
      Vendidos: { todo: ["/item/papelera-2", "/item/barras-3"], multi: ["/item/papelera-2"] },
      Inactivos: { todo: [], multi: [] },
    }
    let catalog = "todo"
    let tab = "Activos"
    const sw = document.getElementById("switch")
    function label() {
      sw.setAttribute("aria-label", "Catálogo seleccionado, " + (catalog === "todo" ? "Todo el catálogo" : "Suscripción Multicategoría"))
    }
    function render() {
      const hrefs = DATA[tab][catalog]
      document.getElementById("rows").innerHTML = hrefs.map((h, i) =>
        '<tr id="CatalogItem_' + i + '"><td><a href="https://es.wallapop.com' + h + '">x</a>' +
        (tab === "Vendidos" ? '<wallapop-badge badgetype="sold"></wallapop-badge>' : "") + "</td></tr>").join("")
      document.getElementById("pager").textContent = hrefs.length ? "1 - " + hrefs.length + " de " + hrefs.length : "0 - 0 de 0"
      document.querySelectorAll("wallapop-tab").forEach((el) =>
        el.setAttribute("aria-selected", String(el.getAttribute("aria-label").startsWith(tab))))
    }
    function item(text, value) {
      const el = document.createElement("walla-dropdown-item")
      el.textContent = text
      el.addEventListener("click", () => { catalog = value; label(); render() })
      document.getElementById("items").appendChild(el)
    }
    ${opts.todoMissing ? "" : 'item("Todo el catálogo", "todo")'}
    item("Suscripción Multicategoría", "multi")
    document.querySelectorAll("wallapop-tab").forEach((el) => el.addEventListener("click", () => {
      tab = el.getAttribute("aria-label").split(" ")[0]
      if (${opts.resetOnTab} && tab !== "Activos") { catalog = "multi"; label() }
      render()
    }))
    label(); render()
  </script></body>`
}

let browser: Awaited<ReturnType<typeof chromium.launch>>

beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
})

afterAll(async () => {
  await browser.close()
})

async function catalogPage(opts: { resetOnTab: boolean; todoMissing: boolean }): Promise<Page> {
  const page = await browser.newPage()
  // The tab-ready check never matches a mixed-case tab name and falls back to the
  // default timeout (also on the VPS, ~20 s per tab). Keep that short here.
  page.setDefaultTimeout(2_000)
  await page.route("https://catalog.test/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: proCatalogHtml(opts) }),
  )
  await page.goto(URL_TODO)
  return page
}

describe("Pro tabs are read only under «Todo el catálogo»", () => {
  it("switches back when a tab click restores Multicategoría, and keeps the hidden sale", async () => {
    const page = await catalogPage({ resetOnTab: true, todoMissing: false })
    const result = await scrapeProCatalogs(page)
    expect(result?.sold.map((row) => row.href).sort()).toEqual([
      "https://es.wallapop.com/item/barras-3",
      "https://es.wallapop.com/item/papelera-2",
    ])
    await page.close()
  })

  it("stops the pass instead of reading a filtered Vendidos", async () => {
    const page = await catalogPage({ resetOnTab: true, todoMissing: true })
    expect(await scrapeProCatalogs(page)).toBeNull()
    await page.close()
  })
})
