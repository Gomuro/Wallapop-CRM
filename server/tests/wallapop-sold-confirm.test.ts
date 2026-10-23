import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { log } from "../src/lib/log"
import { takeSoldJobPages } from "../src/lib/wallapop-cdp/worker-pages"
import { clickMarkAsSoldConfirm, isNavigationError } from "../src/lib/wallapop-sold/click"
import { clickSellerSoldAndWaitTab } from "../src/lib/wallapop-sold/nav"
import { saveSoldSnapshot } from "../src/lib/wallapop-sold/snapshot"
import { soldErrorAt, WallapopSoldError } from "../src/lib/wallapop-sold/types"

vi.mock("../src/lib/log", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/log")>()
  return { ...actual, log: vi.fn(actual.log) }
})

const ITEM_URL = "https://es.wallapop.com/item/mesa-escritorio-plegable-1316233915"
const NEXT_URL = "https://es.wallapop.com/app/catalog/published?sold=1316233915"

type SaleFlow = {
  /** After Marcar como vendido Wallapop opens the next page in a new tab, loads it in this tab, or does nothing. */
  next: "popup" | "same_tab" | "none"
  goAfterMs?: number
  /** The next page answers this late, like the proxy under load. */
  serveAfterMs?: number
  /** The confirm shows this long after the next page has loaded. */
  modalAfterMs?: number
  /** The next page moves on once more before it shows the confirm. */
  redirectFirst?: boolean
}

/** Seller block on /item/, like wallapop-item-seller-sold.html. */
function itemHtml(flow: SaleFlow): string {
  return `<!DOCTYPE html><body>
    <div class="item-detail-actions-module-scss-module__mqkeBq__ItemDetailSellerButtons">
      <walla-button text="Editar"></walla-button>
      <walla-button text="Marcar como vendido"></walla-button>
    </div>
    <script>
      const flow = ${JSON.stringify(flow)}
      document.querySelector('walla-button[text="Marcar como vendido"]').addEventListener("click", () => {
        setTimeout(() => {
          if (flow.next === "popup") window.open(${JSON.stringify(NEXT_URL)}, "_blank")
          if (flow.next === "same_tab") location.assign(${JSON.stringify(NEXT_URL)})
        }, flow.goAfterMs || 0)
      })
    </script>
  </body>`
}

/** The page with tsl-sold-modal, like wallapop-sold-modal.html, rendered after it loads. */
function nextHtml(flow: SaleFlow): string {
  return `<!DOCTYPE html><body>
    <p>Cargando</p>
    <script>
      const flow = ${JSON.stringify(flow)}
      if (flow.redirectFirst && !location.search.includes("again")) {
        setTimeout(() => location.replace(location.href + "&again=1"), 300)
      } else {
        setTimeout(() => {
          document.body.insertAdjacentHTML("beforeend", '<ngb-modal-window role="dialog"><tsl-sold-modal>'
            + '<walla-button id="cancelButton" text="Cancelar"></walla-button>'
            + '<walla-button id="markAsSoldButton" text="Marcar como vendido"></walla-button>'
            + '</tsl-sold-modal></ngb-modal-window>')
          document.getElementById("markAsSoldButton").addEventListener("click", () => {
            window.__soldConfirmed = true
          })
        }, flow.modalAfterMs || 0)
      }
    </script>
  </body>`
}

async function serve(route: Route, flow: SaleFlow): Promise<void> {
  const url = route.request().url()
  if (url.startsWith(NEXT_URL)) {
    await new Promise((resolve) => setTimeout(resolve, flow.serveAfterMs ?? 0))
    await route.fulfill({ contentType: "text/html", body: nextHtml(flow) }).catch(() => {})
    return
  }
  if (url === ITEM_URL) {
    await route.fulfill({ contentType: "text/html", body: itemHtml(flow) })
    return
  }
  await route.abort()
}

let browser: Browser
let context: BrowserContext | null = null

async function openItem(flow: SaleFlow): Promise<Page> {
  context = await browser.newContext()
  await context.route("https://es.wallapop.com/**", (route) => serve(route, flow))
  const page = await context.newPage()
  await page.goto(ITEM_URL)
  return page
}

function logged(msg: string): unknown[] {
  return vi
    .mocked(log)
    .mock.calls.filter((call) => call[1] === msg)
    .map((call) => call[2])
}

async function confirmed(tab: Page): Promise<boolean> {
  return Boolean(await tab.evaluate("window.__soldConfirmed === true"))
}

beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
})

afterAll(async () => {
  await browser.close()
})

beforeEach(() => {
  vi.mocked(log).mockClear()
  takeSoldJobPages()
})

afterEach(async () => {
  await context?.close()
  context = null
})

describe("clickSellerSoldAndWaitTab", () => {
  it("takes the confirm in the same tab once Wallapop has loaded the next page", async () => {
    const page = await openItem({ next: "same_tab", goAfterMs: 200, serveAfterMs: 400, modalAfterMs: 600 })
    const tab = await clickSellerSoldAndWaitTab(page, 10_000)
    expect(tab).toBe(page)
    await clickMarkAsSoldConfirm(tab)
    expect(await confirmed(tab)).toBe(true)
    expect(logged("wallapop_sold_modal_same_tab")).toEqual([{ url: NEXT_URL, waitedMs: expect.any(Number) }])
  })

  it("keeps reading while the tab moves on twice before the confirm shows", async () => {
    const page = await openItem({
      next: "same_tab",
      goAfterMs: 100,
      serveAfterMs: 300,
      modalAfterMs: 500,
      redirectFirst: true,
    })
    const tab = await clickSellerSoldAndWaitTab(page, 10_000)
    expect(tab.url()).toBe(`${NEXT_URL}&again=1`)
    await clickMarkAsSoldConfirm(tab)
    expect(await confirmed(tab)).toBe(true)
  })

  it("waits for the confirm in a new tab and closes that tab with the job", async () => {
    const page = await openItem({ next: "popup", modalAfterMs: 700 })
    const tab = await clickSellerSoldAndWaitTab(page, 10_000)
    expect(tab).not.toBe(page)
    expect(tab.url()).toBe(NEXT_URL)
    await clickMarkAsSoldConfirm(tab)
    expect(await confirmed(tab)).toBe(true)
    expect(takeSoldJobPages()).toEqual([tab])
  })

  it("does not take a window another job opens in the same Chrome", async () => {
    const page = await openItem({ next: "same_tab", goAfterMs: 600, modalAfterMs: 300 })
    const waiting = clickSellerSoldAndWaitTab(page, 10_000)
    await new Promise((resolve) => setTimeout(resolve, 150))
    const other = await context!.newPage()
    const tab = await waiting
    expect(tab).toBe(page)
    expect(other.isClosed()).toBe(false)
    expect(takeSoldJobPages()).toEqual([])
  })

  it("stops at the time limit and logs what the tab showed", async () => {
    const page = await openItem({ next: "none" })
    const started = Date.now()
    await expect(clickSellerSoldAndWaitTab(page, 1_500)).rejects.toMatchObject({
      step: "confirm",
      message: "No se encontró el confirmador #markAsSoldButton.",
    })
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_500)
    expect(logged("wallapop_sold_confirm_missing")).toEqual([
      expect.objectContaining({
        url: ITEM_URL,
        buttons: ["Editar", "Marcar como vendido"],
        soldModal: false,
        popups: [],
        snapshot: null,
      }),
    ])
  })
})

describe("isNavigationError", () => {
  it("reads a destroyed context as a page that moved on, and a closed one as a real error", () => {
    expect(
      isNavigationError(
        new Error("page.evaluate: Execution context was destroyed, most likely because of a navigation"),
      ),
    ).toBe(true)
    expect(isNavigationError(new Error("page.evaluate: Target page, context or browser has been closed"))).toBe(false)
  })
})

describe("soldErrorAt", () => {
  it("keeps the step a raw Playwright error stopped at", () => {
    const raw = new Error("page.evaluate: Execution context was destroyed, most likely because of a navigation")
    const failed = soldErrorAt("confirm", raw)
    expect(failed).toBeInstanceOf(WallapopSoldError)
    expect(failed.step).toBe("confirm")
    expect(failed.message).toBe(raw.message)
  })

  it("leaves a WallapopSoldError as it is", () => {
    const own = new WallapopSoldError("vendidos", "El anuncio no apareció en Vendidos.")
    expect(soldErrorAt("confirm", own)).toBe(own)
  })
})

describe("saveSoldSnapshot", () => {
  it("writes a screenshot and the HTML without its scripts", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "sold-snapshot-"))
    const page = await browser.newPage()
    try {
      await page.setContent(`<body><p>¿Marcar producto como vendido?</p><script>window.token = "secret-token"</script></body>`)
      const base = await saveSoldSnapshot(page, "confirm-last", dir)
      expect(base).toBe(path.join(dir, "confirm-last"))
      const html = await readFile(`${base}.html`, "utf8")
      expect(html).toContain("¿Marcar producto como vendido?")
      expect(html).not.toContain("secret-token")
      expect((await readFile(`${base}.png`)).subarray(1, 4).toString()).toBe("PNG")
    } finally {
      await page.close()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
