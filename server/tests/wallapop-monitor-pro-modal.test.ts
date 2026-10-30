import os from "node:os"

import { chromium, type Page } from "playwright"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { closeProCatalogModal } from "../src/lib/wallapop-monitor/pro-catalog-modal"

/** Synthetic until the first real close logs the modal outerHTML. */
const MODAL = `
  <wallapop-modal id="modal"></wallapop-modal>
  <script>
    window.clicks = []
    const root = document.querySelector("#modal").attachShadow({ mode: "open" })
    root.innerHTML = \`
      <h2>Se ha rediseñado el catálogo Pro</h2>
      <wallapop-button id="skip">Saltar</wallapop-button>
      <wallapop-button id="tour">Empezar</wallapop-button>\`
    root.querySelector("#skip").attachShadow({ mode: "open" }).innerHTML = "<button><slot></slot></button>"
    root.querySelector("#skip").addEventListener("click", () => {
      window.clicks.push("skip")
      document.querySelector("#modal").remove()
    })
    root.querySelector("#tour").addEventListener("click", () => window.clicks.push("tour"))
  </script>
`

let browser: Awaited<ReturnType<typeof chromium.launch>>

beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
})

afterAll(async () => {
  await browser.close()
})

async function pageWith(html: string): Promise<Page> {
  const page = await browser.newPage()
  await page.setContent(`<body>${html}<button onclick="window.clicks.push('outside')">Saltar</button></body>`)
  await page.evaluate("window.clicks = window.clicks || []")
  return page
}

const clicks = (page: Page) => page.evaluate("window.clicks") as Promise<string[]>

describe("closeProCatalogModal", () => {
  it("clicks Saltar inside the redesign modal, also behind shadow roots", async () => {
    const page = await pageWith(MODAL)
    expect(await closeProCatalogModal(page, "Activos", os.tmpdir())).toBe(true)
    expect(await clicks(page)).toEqual(["skip"])
    expect(await page.$("#modal")).toBeNull()
    await page.close()
  })

  it("clicks nothing when there is no redesign modal", async () => {
    const page = await pageWith("<table><tr><td>Activos</td></tr></table>")
    expect(await closeProCatalogModal(page, "Activos", os.tmpdir())).toBe(false)
    expect(await clicks(page)).toEqual([])
    await page.close()
  })

  it("clicks nothing when the button text is not exactly Saltar", async () => {
    const page = await pageWith(
      `<div role="dialog"><p>Se ha rediseñado el catálogo Pro</p><button onclick="window.clicks.push('tour')">Saltar tour</button></div>`,
    )
    expect(await closeProCatalogModal(page, "Activos", os.tmpdir())).toBe(false)
    expect(await clicks(page)).toEqual([])
    await page.close()
  })

  it("clicks nothing when rediseñado is not inside a dialog", async () => {
    const page = await pageWith(
      `<section><p>Se ha rediseñado el catálogo Pro</p><button onclick="window.clicks.push('section')">Saltar</button></section>`,
    )
    expect(await closeProCatalogModal(page, "Activos", os.tmpdir())).toBe(false)
    expect(await clicks(page)).toEqual([])
    await page.close()
  })

  it("clicks nothing when the dialog with Saltar does not mention the redesign", async () => {
    const page = await pageWith(
      `<div role="dialog"><p>Otra cosa</p><button onclick="window.clicks.push('other')">Saltar</button></div>`,
    )
    expect(await closeProCatalogModal(page, "Activos", os.tmpdir())).toBe(false)
    expect(await clicks(page)).toEqual([])
    await page.close()
  })
})
