import { chromium, type Browser, type BrowserContext, type Page } from "playwright"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { log } from "../src/lib/log"
import { verifySoldInVendidos } from "../src/lib/wallapop-sold/vendidos"

vi.mock("../src/lib/log", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/log")>()
  return { ...actual, log: vi.fn(actual.log) }
})

const ORIGIN = "https://es.wallapop.com"
const SOLD_ITEM = `${ORIGIN}/item/bomba-de-pozo-profundo-750w-100-l-min-1316663657`
const OTHER_SOLD = `${ORIGIN}/item/papelera-2`

type ProOpts = {
  /** Vendidos under «Todo el catálogo». Multicategoría only shows OTHER_SOLD. */
  todoSold: string[]
}

/**
 * PRO catalog like /app/catalog/management on Principal: the switcher remembers
 * «Suscripción Multicategoría», three tabs, table rows with the sold badge.
 */
function proHtml(opts: ProOpts): string {
  return `<!DOCTYPE html><body>
  <div id="switch" aria-label="Catálogo seleccionado, Suscripción Multicategoría"></div>
  <div id="items"></div>
  <wallapop-tab aria-label="Activos (2)" aria-selected="true"></wallapop-tab>
  <wallapop-tab aria-label="Vendidos (${opts.todoSold.length})" aria-selected="false"></wallapop-tab>
  <wallapop-tab aria-label="Inactivos (0)" aria-selected="false"></wallapop-tab>
  <table id="rows"></table>
  <tsl-pagination-actions><span class="PaginationActions__info" id="pager"></span>
    <walla-icon class="PaginationActions__action PaginationActions__action--disabled"></walla-icon>
  </tsl-pagination-actions>
  <script>
    const DATA = {
      Activos: { todo: ["/item/olla-1", "/item/silla-4"], multi: ["/item/olla-1", "/item/silla-4"] },
      Vendidos: { todo: ${JSON.stringify(opts.todoSold.map((href) => new URL(href).pathname))}, multi: ["/item/papelera-2"] },
      Inactivos: { todo: [], multi: [] },
    }
    let catalog = "multi"
    let tab = "Activos"
    const sw = document.getElementById("switch")
    function render() {
      sw.setAttribute("aria-label", "Catálogo seleccionado, " + (catalog === "todo" ? "Todo el catálogo" : "Suscripción Multicategoría"))
      const hrefs = DATA[tab][catalog]
      document.getElementById("rows").innerHTML = hrefs.map((h, i) =>
        '<tr id="CatalogItem_' + i + '"><td><a href="${ORIGIN}' + h + '">x</a>' +
        (tab === "Vendidos" ? '<wallapop-badge badgetype="sold"></wallapop-badge>' : "") + "</td></tr>").join("")
      document.getElementById("pager").textContent = hrefs.length ? "1 - " + hrefs.length + " de " + hrefs.length : "0 - 0 de 0"
      document.querySelectorAll("wallapop-tab").forEach((el) =>
        el.setAttribute("aria-selected", String(el.getAttribute("aria-label").startsWith(tab))))
    }
    for (const [text, value] of [["Todo el catálogo", "todo"], ["Suscripción Multicategoría", "multi"]]) {
      const el = document.createElement("walla-dropdown-item")
      el.textContent = text
      el.addEventListener("click", () => { catalog = value; render() })
      document.getElementById("items").appendChild(el)
    }
    document.querySelectorAll("wallapop-tab").forEach((el) => el.addEventListener("click", () => {
      tab = el.getAttribute("aria-label").split(" ")[0]
      render()
    }))
    render()
  </script></body>`
}

/** Classic W2: published cards with the Vendidos nav link, then /app/catalog/sold cards. */
function classicPublishedHtml(): string {
  return `<!DOCTYPE html><body>
    <a class="nav-link" href="/app/catalog/sold">Vendidos</a>
    <tsl-catalog-item><div class="CatalogItem__content"><a href="${ORIGIN}/item/olla-1">Olla</a></div></tsl-catalog-item>
  </body>`
}

function classicSoldHtml(hrefs: string[]): string {
  return `<!DOCTYPE html><body>${hrefs
    .map(
      (href) =>
        `<tsl-catalog-item><div class="CatalogItem__content CatalogItem__content--sold"><a href="${href}">x</a></div></tsl-catalog-item>`,
    )
    .join("")}</body>`
}

let browser: Browser
let context: BrowserContext | null = null

async function openAt(path: string, pages: Record<string, string>): Promise<Page> {
  context = await browser.newContext()
  await context.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url())
    const body = pages[url.pathname]
    if (body == null) return route.abort()
    await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body })
  })
  const page = await context.newPage()
  page.setDefaultTimeout(5_000)
  await page.goto(`${ORIGIN}${path}`)
  return page
}

function verifyLogs(): Record<string, unknown>[] {
  return vi
    .mocked(log)
    .mock.calls.filter((call) => call[1] === "wallapop_sold_vendidos_verify")
    .map((call) => call[2] as Record<string, unknown>)
}

beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
})

afterAll(async () => {
  await browser.close()
})

beforeEach(() => {
  vi.mocked(log).mockClear()
})

afterEach(async () => {
  await context?.close()
  context = null
})

describe("verifySoldInVendidos on PRO (Principal)", () => {
  it("switches from Multicategoría to «Todo el catálogo», opens Vendidos and finds the item", async () => {
    const html = proHtml({ todoSold: [OTHER_SOLD, SOLD_ITEM] })
    const page = await openAt("/app/catalog/management/consumergoods", {
      "/app/catalog/management/consumergoods": html,
      "/app/catalog/management": html,
    })
    expect(await verifySoldInVendidos(page, SOLD_ITEM, false)).toBe(true)
    expect(verifyLogs()).toEqual([
      expect.objectContaining({
        ok: true,
        kind: "pro",
        anywhere: true,
        url: `${ORIGIN}/app/catalog/management`,
        tab: "Vendidos",
        catalog: "Catálogo seleccionado, Todo el catálogo",
        scanned: 2,
      }),
    ])
  }, 60_000)

  it("fails when the item is not among the sold rows", async () => {
    const html = proHtml({ todoSold: [OTHER_SOLD] })
    const page = await openAt("/app/catalog/management/consumergoods", {
      "/app/catalog/management/consumergoods": html,
      "/app/catalog/management": html,
    })
    expect(await verifySoldInVendidos(page, SOLD_ITEM, true)).toBe(false)
    expect(verifyLogs()).toEqual([
      expect.objectContaining({ ok: false, kind: "pro", read: true, scanned: 1, tab: "Vendidos" }),
    ])
  }, 60_000)
})

describe("verifySoldInVendidos on a classic account (W2)", () => {
  it("keeps the old check: /app/catalog/sold, the item is the first sold card", async () => {
    const page = await openAt("/app/catalog/published", {
      "/app/catalog/published": classicPublishedHtml(),
      "/app/catalog/sold": classicSoldHtml([SOLD_ITEM, OTHER_SOLD]),
    })
    expect(await verifySoldInVendidos(page, SOLD_ITEM, false)).toBe(true)
    expect(verifyLogs()).toEqual([
      expect.objectContaining({ ok: true, kind: "classic", url: `${ORIGIN}/app/catalog/sold`, scanned: 2 }),
    ])
  }, 60_000)

  it("still fails when the item is not the first sold card and the check needs the first", async () => {
    const page = await openAt("/app/catalog/published", {
      "/app/catalog/published": classicPublishedHtml(),
      "/app/catalog/sold": classicSoldHtml([OTHER_SOLD, SOLD_ITEM]),
    })
    expect(await verifySoldInVendidos(page, SOLD_ITEM, false)).toBe(false)
  }, 60_000)
})
