import { chromium, type Page } from "playwright"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { scrapeProCatalogs } from "../src/lib/wallapop-monitor/pro-catalog"
import { listedPageReadyEval } from "../src/lib/wallapop-monitor/pro-catalog-pages"

const URL_TODO = "https://catalog.test/app/catalog/management"

/**
 * A small Pro catalog: a «Catálogo seleccionado» switcher, three tabs, one page
 * per tab. Under Multicategoría, Vendidos hides the motor sale (like Barras).
 * `resetOnTab`: clicking a tab brings the remembered Multicategoría back.
 * `resetOnce`: only the first such click does. `reloadOnSwitchMs`: picking a
 * catalog reloads the list a moment later and lands on Activos (VPS 3.11 10:57Z).
 */
type CatalogOpts = { resetOnTab: boolean; todoMissing: boolean; resetOnce?: boolean; reloadOnSwitchMs?: number }

function proCatalogHtml(opts: CatalogOpts): string {
  return `<body>
  <div class="walla-dropdown__inner-input" id="switch" aria-label="Catálogo seleccionado, Todo el catálogo"></div>
  <div id="items"></div>
  <wallapop-tab aria-label="Activos (3)" aria-selected="true"></wallapop-tab>
  <wallapop-tab aria-label="Vendidos (3)" aria-selected="false"></wallapop-tab>
  <wallapop-tab aria-label="Inactivos (0)" aria-selected="false"></wallapop-tab>
  <table id="rows"></table>
  <tsl-pagination-actions><span class="PaginationActions__info" id="pager"></span>
    <walla-icon class="PaginationActions__action" id="prev"></walla-icon><walla-icon class="PaginationActions__action" id="next"></walla-icon>
  </tsl-pagination-actions>
  <script>
    const DATA = {
      Activos: { todo: ["/item/olla-1", "/item/silla-4", "/item/mesa-5"], multi: ["/item/olla-1", "/item/silla-4", "/item/mesa-5"] },
      Vendidos: { todo: ["/item/papelera-2", "/item/barras-3", "/item/cobertizo-6"], multi: ["/item/papelera-2"] },
      Inactivos: { todo: [], multi: [] },
    }
    let catalog = "todo"
    let tab = "Activos"
    let pageNo = 0
    const SIZE = 2
    const sw = document.getElementById("switch")
    function label() {
      sw.setAttribute("aria-label", "Catálogo seleccionado, " + (catalog === "todo" ? "Todo el catálogo" : "Suscripción Multicategoría"))
    }
    function render() {
      const all = DATA[tab][catalog]
      const hrefs = all.slice(pageNo * SIZE, pageNo * SIZE + SIZE)
      document.getElementById("rows").innerHTML = hrefs.map((h, i) =>
        '<tr id="CatalogItem_' + i + '"><td><a href="https://es.wallapop.com' + h + '">x</a>' +
        (tab === "Vendidos" ? '<wallapop-badge badgetype="sold"></wallapop-badge>' : "") + "</td></tr>").join("")
      const from = pageNo * SIZE + 1
      document.getElementById("pager").textContent = hrefs.length ? from + " - " + (from + hrefs.length - 1) + " de " + all.length : "0 - 0 de 0"
      document.getElementById("next").classList.toggle("PaginationActions__action--disabled", (pageNo + 1) * SIZE >= all.length)
      document.querySelectorAll("wallapop-tab").forEach((el) =>
        el.setAttribute("aria-selected", String(el.getAttribute("aria-label").startsWith(tab))))
    }
    function item(text, value) {
      const el = document.createElement("walla-dropdown-item")
      el.textContent = text
      el.addEventListener("click", () => {
        catalog = value; pageNo = 0; label(); render()
        ${opts.reloadOnSwitchMs ? `setTimeout(() => { tab = "Activos"; pageNo = 0; render() }, ${opts.reloadOnSwitchMs})` : ""}
      })
      document.getElementById("items").appendChild(el)
    }
    ${opts.todoMissing ? "" : 'item("Todo el catálogo", "todo")'}
    item("Suscripción Multicategoría", "multi")
    let resets = 0
    document.querySelectorAll("wallapop-tab").forEach((el) => el.addEventListener("click", () => {
      tab = el.getAttribute("aria-label").split(" ")[0]
      pageNo = 0
      const mayReset = ${opts.resetOnTab} && (!${Boolean(opts.resetOnce)} || resets === 0)
      if (mayReset && tab !== "Activos") { catalog = "multi"; resets += 1; label() }
      render()
    }))
    document.getElementById("next").addEventListener("click", () => { pageNo += 1; render() })
    document.getElementById("prev").addEventListener("click", () => { pageNo = Math.max(0, pageNo - 1); render() })
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

async function catalogPage(opts: CatalogOpts): Promise<Page> {
  const page = await browser.newPage()
  // A wait that never matches should fail fast here, not after 30 s.
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
      "https://es.wallapop.com/item/cobertizo-6",
      "https://es.wallapop.com/item/papelera-2",
    ])
    await page.close()
  })

  it("reopens Vendidos when the switch reloads the list on Activos", async () => {
    const page = await catalogPage({ resetOnTab: true, resetOnce: true, todoMissing: false, reloadOnSwitchMs: 1_000 })
    const result = await scrapeProCatalogs(page)
    expect(result?.sold.map((row) => row.href).sort()).toEqual([
      "https://es.wallapop.com/item/barras-3",
      "https://es.wallapop.com/item/cobertizo-6",
      "https://es.wallapop.com/item/papelera-2",
    ])
    expect(result?.published).toHaveLength(3)
    await page.close()
  }, 60_000)

  it("stops the pass instead of reading a filtered Vendidos", async () => {
    const page = await catalogPage({ resetOnTab: true, todoMissing: true })
    expect(await scrapeProCatalogs(page)).toBeNull()
    await page.close()
  })
})

describe("tab ready check", () => {
  it("matches a mixed-case tab name once its rows are listed (VPS waited ~20 s per tab)", async () => {
    const page = await catalogPage({ resetOnTab: false, todoMissing: false })
    await page.evaluate(`document.querySelector('wallapop-tab[aria-label^="Vendidos"]').click()`)
    expect(await page.evaluate(listedPageReadyEval({ tab: "Vendidos" }))).toBe(true)
    expect(await page.evaluate(listedPageReadyEval({ tab: "Activos" }))).toBe(false)
    await page.close()
  })
})
