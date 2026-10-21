import fs from "node:fs"
import path from "node:path"

import { chromium, type Page } from "playwright"
import { describe, expect, it } from "vitest"

import type { CategoryUploadField } from "../../lib/inventory/category-upload-fields"
import { productListingApiPutBodySchema } from "../../lib/validations/listing"
import { ensureCategorySelected } from "../src/lib/wallapop-publish/category"
import { normalizeCategoryLabel } from "../src/lib/wallapop-publish/category-menu"
import { ensureExtraUploadFields } from "../src/lib/wallapop-publish/extra-fields"
import { selectConsumerGoods } from "../src/lib/wallapop-publish/flow"
import { dismissSearchOverlay } from "../src/lib/wallapop-publish/nav"
import {
  classifyPublishLanding,
  clickMarcaCatalogItem,
  clickMarcaCrearOption,
  ensureEnvioToggle,
  ensurePackageSizeIfShown,
  ensureStandardWeightBand,
  envioToggleIsOn,
  firstCatalogItemUrl,
  grabCatalogItemUrl,
  isPublicarContextDestroyedError,
  playwrightClickMessage,
  queryMarcaCombo,
  readBrandValue,
  isWallapopPublishedCatalogUrl,
  listingUrlFromPageUrl,
  crmTitleMatchesForm,
  normalizePublishTitle,
  parseCatalogPriceEur,
  pickUniqueCatalogItemUrl,
  PRO_CATALOG_ITEMS_EVAL,
  PUBLISHED_CATALOG_ITEMS_EVAL,
  readLandingAfterPublicarClick,
  readUrlAfterPublicarClick,
  roleRadioIsChecked,
  type PublishedCatalogItem,
} from "../src/lib/wallapop-publish"
import { WallapopPublishError } from "../src/lib/wallapop-publish/types"
import { shouldRevertPublishClaim } from "../src/routes/product-publish"

const colorField: CategoryUploadField = {
  id: "color",
  type: "list",
  required: true,
  label: "Color",
  min: 1,
  max: 2,
  options: [{ id: "black", title: "Negro" }],
  source: null,
}

const COLOR_LIST_HTML = `
  <walla-dropdown data-testid="color">
    <div role="button">Color*</div>
    <div class="walla-dropdown__floating-area" style="display:block;height:80px">
      <walla-dropdown-item role="option" aria-label="Negro" style="display:block;height:40px">
        <input id="black" type="checkbox">
      </walla-dropdown-item>
      <walla-button id="ok" style="display:block;width:200px;height:40px"></walla-button>
    </div>
  </walla-dropdown>`

describe("normalizeCategoryLabel", () => {
  it("matches Wallapop aria-label when CRM nameEs trails a space", () => {
    const crm = "Aire acondicionado y ventiladores "
    const wallapop = "Aire acondicionado y ventiladores"
    expect(["Aire acondicionado y ventiladores"].includes(crm)).toBe(false)
    expect(normalizeCategoryLabel(crm)).toBe(wallapop)
  })
})

describe("crmTitleMatchesForm", () => {
  it("treats whitespace as the same title", () => {
    expect(
      crmTitleMatchesForm(
        "  Lámpara led inteligente Meross ",
        "Lámpara led inteligente Meross",
      ),
    ).toBe(true)
  })

  it("rejects Wallapop AI title rewrites", () => {
    expect(
      crmTitleMatchesForm(
        "Lámpara LED Meross Inteligente",
        "Lámpara led inteligente Meross",
      ),
    ).toBe(false)
  })
})

describe("readUrlAfterPublicarClick", () => {
  it("returns the listing URL when the page stays open", async () => {
    const url = await readUrlAfterPublicarClick(
      {
        waitForTimeout: async () => undefined,
        url: () => "https://es.wallapop.com/item/abc",
      },
      0,
    )
    expect(url).toBe("https://es.wallapop.com/item/abc")
  })

  it("marks Target closed as urlReadFailed, not as /item/", async () => {
    const landing = await readLandingAfterPublicarClick(
      {
        waitForTimeout: async () => {
          throw new Error("Target closed")
        },
        url: () => "https://es.wallapop.com/app/catalog/published",
      },
      0,
    )
    expect(landing).toEqual({ url: null, urlReadFailed: true })
  })

  it("returns null if wait or url throws after Publicar (Target closed)", async () => {
    const fromWait = await readUrlAfterPublicarClick(
      {
        waitForTimeout: async () => {
          throw new Error("Target closed")
        },
        url: () => "https://es.wallapop.com/item/abc",
      },
      0,
    )
    expect(fromWait).toBeNull()

    const fromUrl = await readUrlAfterPublicarClick(
      {
        waitForTimeout: async () => undefined,
        url: () => {
          throw new Error("Target closed")
        },
      },
      0,
    )
    expect(fromUrl).toBeNull()
  })
})

describe("listingUrlFromPageUrl", () => {
  it("keeps Wallapop item URLs", () => {
    expect(listingUrlFromPageUrl("https://es.wallapop.com/item/1")).toBe(
      "https://es.wallapop.com/item/1",
    )
  })

  it("rejects the upload form URL (Publicar bounced, not posted)", () => {
    expect(
      listingUrlFromPageUrl(
        "https://es.wallapop.com/app/catalog/upload/consumer-goods",
      ),
    ).toBeNull()
  })

  it("rejects the Wallapop homepage (not a listing)", () => {
    expect(listingUrlFromPageUrl("https://es.wallapop.com")).toBeNull()
    expect(listingUrlFromPageUrl("https://es.wallapop.com/")).toBeNull()
  })

  it("drops other hosts", () => {
    expect(listingUrlFromPageUrl("https://example.com/x")).toBeNull()
  })
})

describe("classifyPublishLanding", () => {
  const published = "https://es.wallapop.com/app/catalog/published"

  it("accepts Tu Catálogo published as hung", () => {
    expect(
      classifyPublishLanding({
        url: published,
        urlReadFailed: false,
        reviewMessage: null,
      }),
    ).toEqual({ ok: true, reason: "published_catalog" })
    expect(isWallapopPublishedCatalogUrl(published)).toBe(true)
    const management =
      "https://es.wallapop.com/app/catalog/management/consumergoods"
    expect(
      classifyPublishLanding({
        url: management,
        urlReadFailed: false,
        reviewMessage: null,
      }),
    ).toEqual({ ok: true, reason: "published_catalog" })
    expect(isWallapopPublishedCatalogUrl(management)).toBe(true)
  })

  it("rejects upload form and Revisa banner", () => {
    expect(
      classifyPublishLanding({
        url: "https://es.wallapop.com/app/catalog/upload/consumer-goods",
        urlReadFailed: false,
        reviewMessage: null,
      }).reason,
    ).toBe("still_on_upload")
    expect(
      classifyPublishLanding({
        url: "https://es.wallapop.com/app/catalog/upload/consumer-goods",
        urlReadFailed: false,
        reviewMessage: "Wallapop pidió revisar campos en rojo.",
      }).reason,
    ).toBe("review_banner")
  })

  it("does not mark ACTIVE when the tab is gone or URL is not the catalog", () => {
    expect(
      classifyPublishLanding({
        url: null,
        urlReadFailed: true,
        reviewMessage: null,
      }).reason,
    ).toBe("target_closed")
    expect(
      classifyPublishLanding({
        url: "https://es.wallapop.com/wall",
        urlReadFailed: false,
        reviewMessage: null,
      }).reason,
    ).toBe("unexpected_url")
  })
})

describe("firstCatalogItemUrl", () => {
  it("takes the first public /item/ href (new post is first ~98%)", () => {
    expect(
      firstCatalogItemUrl([
        {
          title: "Mesa Auxiliar Cama Teqler Regulable",
          href: "https://es.wallapop.com/item/mesa-auxiliar-cama-teqler-regulable-1310760208",
          priceText: "44,95 €",
        },
        {
          title: "Silla Ducha Ajustable Altura",
          href: "https://es.wallapop.com/item/silla-ducha-ajustable-altura-1310699845",
          priceText: "27,95 €",
        },
      ]),
    ).toBe(
      "https://es.wallapop.com/item/mesa-auxiliar-cama-teqler-regulable-1310760208",
    )
  })

  it("skips rows without a public /item/ href", () => {
    expect(
      firstCatalogItemUrl([
        { title: "Empty", href: "", priceText: "1 €" },
        {
          title: "Next",
          href: "https://es.wallapop.com/item/next-1",
          priceText: "1 €",
        },
      ]),
    ).toBe("https://es.wallapop.com/item/next-1")
  })
})

describe("pickUniqueCatalogItemUrl", () => {
  const helmet = {
    title: "Casco Moto LS2 Advant Carbono XL",
    href: "https://es.wallapop.com/item/casco-moto-ls2-advant-carbono-xl-1309517660",
    priceText: "209,95 €",
  }
  const other = {
    title: "Barrera Seguridad Infantil 73–80 cm",
    href: "https://es.wallapop.com/item/barrera-seguridad-1300000001",
    priceText: "29,99 €",
  }

  it("picks the catalog row by title, not the first item", () => {
    const picked = pickUniqueCatalogItemUrl([other, helmet], {
      title: "Casco Moto LS2 Advant Carbono XL",
      price: 209.95,
    })
    expect(picked).toEqual({ href: helmet.href, reason: "matched" })
    expect(parseCatalogPriceEur(helmet.priceText)).toBe(209.95)
  })

  it("uses price when two rows share the title", () => {
    const cheap = {
      ...helmet,
      href: "https://es.wallapop.com/item/casco-barato-111",
      priceText: "50 €",
    }
    const picked = pickUniqueCatalogItemUrl([cheap, helmet], {
      title: helmet.title,
      price: 209.95,
    })
    expect(picked).toEqual({ href: helmet.href, reason: "matched_price" })
  })

  it("does not write upload/published URLs and does not guess", () => {
    expect(
      pickUniqueCatalogItemUrl(
        [
          {
            title: helmet.title,
            href: "https://es.wallapop.com/app/catalog/published",
            priceText: helmet.priceText,
          },
        ],
        { title: helmet.title, price: 209.95 },
      ).reason,
    ).toBe("none")
    expect(
      pickUniqueCatalogItemUrl(
        [
          { ...helmet, href: "https://es.wallapop.com/item/a-1" },
          { ...helmet, href: "https://es.wallapop.com/item/a-2" },
        ],
        { title: helmet.title, price: 209.95 },
      ).reason,
    ).toBe("ambiguous")
  })

  it("reads the Pro management row by title, not the first item", async () => {
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setContent(`<!DOCTYPE html><table><tbody>
        <tr id="CatalogItem_0">
          <td></td><td></td>
          <td>Philips 2000 Humidificador</td>
          <td>29,99 €</td>
          <td>13/10/2026</td><td>1</td><td>0</td>
          <td><a href="https://es.wallapop.com/item/philips-2000-1">foto</a></td>
        </tr>
        <tr id="CatalogItem_1">
          <td></td><td></td>
          <td>Sartén de hierro colado con revestimiento</td>
          <td>29,99 €</td>
          <td>13/10/2026</td><td>0</td><td>0</td>
          <td><a href="https://es.wallapop.com/item/sarten-hierro-2">foto</a></td>
        </tr>
      </tbody></table>`)
      const rows = (await page.evaluate(PRO_CATALOG_ITEMS_EVAL)) as PublishedCatalogItem[]
      expect(rows[0]?.title).toBe("Philips 2000 Humidificador")
      expect(rows[1]?.priceText).toBe("29,99 €")
      expect(
        pickUniqueCatalogItemUrl(rows, {
          title: "Sartén de hierro colado con revestimiento",
          price: 29.99,
        }),
      ).toEqual({
        href: "https://es.wallapop.com/item/sarten-hierro-2",
        reason: "matched",
      })
    } finally {
      await browser.close()
    }
  })

  it("waits on the first Pro page until the new row appears", async () => {
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setContent(`<!DOCTYPE html><body>
        <table><tbody id="rows">
          <tr id="CatalogItem_0">
            <td>Otro producto</td>
            <td>10,00 €</td>
            <td><a href="https://es.wallapop.com/item/otro-1">foto</a></td>
          </tr>
        </tbody></table>
        <tsl-pagination-actions>
          <span class="PaginationActions__info">1 - 40 de 128</span>
          <walla-icon class="PaginationActions__action" id="next"></walla-icon>
        </tsl-pagination-actions>
      </body>`)
      await page.evaluate(() => {
        window.setTimeout(() => {
          const rows = document.getElementById("rows")
          if (!rows) return
          rows.insertAdjacentHTML(
            "afterbegin",
            '<tr id="CatalogItem_new"><td>Einhell Carro esparcidor manual</td><td>19,95 €</td><td><a href="https://es.wallapop.com/item/einhell-carro-esparcidor-manual-1312904303">foto</a></td></tr>',
          )
        }, 350)
        document.getElementById("next")?.addEventListener("click", () => {
          document.body.dataset.paged = "1"
        })
      })
      const grabbed = await grabCatalogItemUrl(
        page,
        { title: "Einhell Carro esparcidor manual", price: 19.95 },
        2_000,
      )
      expect(grabbed).toMatchObject({
        href: "https://es.wallapop.com/item/einhell-carro-esparcidor-manual-1312904303",
        reason: "matched",
      })
      expect(await page.evaluate(() => document.body.dataset.paged ?? "")).toBe("")
    } finally {
      await browser.close()
    }
  })

  it("walks the next Pro page when the new row is not on the first one", async () => {
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setContent(`<!DOCTYPE html><body>
        <table><tbody id="rows">
          <tr id="CatalogItem_0">
            <td>Otro producto</td>
            <td>10,00 €</td>
            <td><a href="https://es.wallapop.com/item/otro-1">foto</a></td>
          </tr>
        </tbody></table>
        <tsl-pagination-actions>
          <span class="PaginationActions__info">1 - 1 de 2</span>
          <walla-icon class="PaginationActions__action" id="next"></walla-icon>
        </tsl-pagination-actions>
      </body>`)
      await page.evaluate(() => {
        document.getElementById("next")?.addEventListener("click", () => {
          const rows = document.getElementById("rows")
          if (rows) {
            rows.innerHTML =
              '<tr id="CatalogItem_1"><td>Colchón para cunas KUO Baby</td><td>19,95 €</td><td><a href="https://es.wallapop.com/item/colchon-para-cunas-kuo-baby-1312859930">foto</a></td></tr>'
          }
          const info = document.querySelector(".PaginationActions__info")
          if (info) info.textContent = "2 - 2 de 2"
          document.getElementById("next")?.classList.add("PaginationActions__action--disabled")
        })
      })
      const grabbed = await grabCatalogItemUrl(
        page,
        {
          title: "Colchón para cunas KUO Baby",
          price: 19.95,
        },
        400,
      )
      expect(grabbed).toMatchObject({
        href: "https://es.wallapop.com/item/colchon-para-cunas-kuo-baby-1312859930",
        reason: "matched",
        scanned: 2,
      })
    } finally {
      await browser.close()
    }
  })

  it("scrapes the captured tsl-catalog-item HTML like live publish", async () => {
    const html = fs.readFileSync(
      path.join(__dirname, "fixtures/wallapop-tsl-catalog-item.html"),
      "utf8",
    )
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setContent(
        `<!DOCTYPE html><html><body>${html}</body></html>`,
      )
      const rows = (await page.evaluate(
        PUBLISHED_CATALOG_ITEMS_EVAL,
      )) as PublishedCatalogItem[]
      expect(rows).toHaveLength(1)
      expect(normalizePublishTitle(rows[0]?.title ?? "")).toBe(
        "Casco Moto LS2 Advant Carbono XL",
      )
      const picked = pickUniqueCatalogItemUrl(rows, {
        title: "Casco Moto LS2 Advant Carbono XL",
        price: 209.95,
      })
      expect(picked.href).toBe(
        "https://es.wallapop.com/item/casco-moto-ls2-advant-carbono-xl-1309517660",
      )
      expect(picked.reason).toBe("matched")
      expect(firstCatalogItemUrl(rows)).toBe(picked.href)
    } finally {
      await browser.close()
    }
  })

  it("grabs the first /item/ href even when Yuhu covers the row", async () => {
    const html = fs.readFileSync(
      path.join(__dirname, "fixtures/wallapop-tsl-catalog-item.html"),
      "utf8",
    )
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setContent(`<!DOCTYPE html><html><body>
        ${html}
        <tsl-bump-suggestion-modal>
          <walla-dialog class="BumpSuggestionModal">
            <div style="position:fixed;inset:0;background:#000;z-index:9999">
              <p>¡Yuhu! Producto subido</p>
              <button type="button">Ahora no, gracias</button>
            </div>
          </walla-dialog>
        </tsl-bump-suggestion-modal>
      </body></html>`)
      const grabbed = await grabCatalogItemUrl(
        page,
        { title: "other CRM title", price: 1 },
        500,
      )
      expect(grabbed.reason).toBe("first_row")
      expect(grabbed.href).toBe(
        "https://es.wallapop.com/item/casco-moto-ls2-advant-carbono-xl-1309517660",
      )
    } finally {
      await browser.close()
    }
  })
})

describe("playwrightClickMessage", () => {
  it("keeps the Playwright click error and its cause", () => {
    const error = new Error(
      [
        "elementHandle.click: Timeout 8000ms exceeded.",
        "Call log:",
        "  - attempting click action",
        "    - element is outside of the viewport",
      ].join("\n"),
    )
    error.name = "TimeoutError"
    expect(playwrightClickMessage(error)).toBe(
      "elementHandle.click: Timeout 8000ms exceeded. element is outside of the viewport",
    )
  })

  it("keeps an intercept line from the Playwright call log", () => {
    const error = new Error(
      [
        "elementHandle.click: Timeout 8000ms exceeded.",
        "Call log:",
        '  - <div class="overlay">…</div> intercepts pointer events',
      ].join("\n"),
    )
    expect(playwrightClickMessage(error)).toBe(
      "elementHandle.click: Timeout 8000ms exceeded. <div class=\"overlay\">…</div> intercepts pointer events",
    )
  })
})

describe("isPublicarContextDestroyedError", () => {
  it("detects Target closed / destroyed context", () => {
    expect(
      isPublicarContextDestroyedError(new Error("Target closed")),
    ).toBe(true)
    expect(
      isPublicarContextDestroyedError(
        new Error("Execution context was destroyed"),
      ),
    ).toBe(true)
    expect(isPublicarContextDestroyedError(new Error("timeout"))).toBe(false)
  })
})

describe("clicked Publicar revert policy", () => {
  it("never reverts after Publicar click even if URL read failed", () => {
    const claimed = true
    const postedOnWallapop = false
    const clickedPublicar = true
    expect(
      shouldRevertPublishClaim(claimed, postedOnWallapop, clickedPublicar),
    ).toBe(false)
  })

  it("reverts only when claimed and Publicar was never clicked", () => {
    expect(shouldRevertPublishClaim(true, false, false)).toBe(true)
  })
})

describe("productListingApiPutBodySchema", () => {
  it("keeps public /item/ URLs and coerces junk to null", () => {
    expect(
      productListingApiPutBodySchema.parse({
        externalUrl: "https://es.wallapop.com/item/andador",
      }).externalUrl,
    ).toBe("https://es.wallapop.com/item/andador")
    expect(
      productListingApiPutBodySchema.parse({
        externalUrl: "https://es.wallapop.com",
      }).externalUrl,
    ).toBeNull()
    expect(
      productListingApiPutBodySchema.parse({
        externalUrl:
          "https://es.wallapop.com/app/catalog/upload/consumer-goods",
      }).externalUrl,
    ).toBeNull()
    expect(
      productListingApiPutBodySchema.parse({ externalUrl: "" }).externalUrl,
    ).toBeNull()
  })

  it("accepts shippingEnabled", () => {
    expect(
      productListingApiPutBodySchema.parse({ shippingEnabled: false })
        .shippingEnabled,
    ).toBe(false)
    expect(
      productListingApiPutBodySchema.parse({ shippingEnabled: true })
        .shippingEnabled,
    ).toBe(true)
  })
})

function envioFixtureSection(id: string) {
  const html = fs.readFileSync(
    path.join(__dirname, "fixtures/wallapop-envio-form.html"),
    "utf8",
  )
  const match = html.match(new RegExp(`<section id="${id}"[\\s\\S]*?</section>`))
  if (!match) throw new Error(`Missing fixture section ${id}`)
  return match[0]
}

async function withEnvioPage(html: string, run: (page: Page) => Promise<void>) {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent(`<!DOCTYPE html><html><body>${html}</body></html>`)
    await run(page)
  } finally {
    await browser.close()
  }
}

describe("Wallapop envío DOM", () => {
  it("turns Activar envío off and on", async () => {
    await withEnvioPage(envioFixtureSection("envio-toggle-and-package"), async (page) => {
      expect(await envioToggleIsOn(page)).toBe(true)
      await ensureEnvioToggle(page, true)
      expect(await envioToggleIsOn(page)).toBe(true)
      await ensureEnvioToggle(page, false)
      expect(await envioToggleIsOn(page)).toBe(false)
      await ensureEnvioToggle(page, true)
      expect(await envioToggleIsOn(page)).toBe(true)
    })
  })

  it("selects Estándar (delivery) over bulky", async () => {
    await withEnvioPage(envioFixtureSection("envio-toggle-and-package"), async (page) => {
      expect(await roleRadioIsChecked(page, "bulky")).toBe(true)
      await ensurePackageSizeIfShown(page, "STANDARD")
      expect(await roleRadioIsChecked(page, "delivery")).toBe(true)
      expect(await roleRadioIsChecked(page, "bulky")).toBe(false)
    })
  })

  it("keeps bulky when package type is BULKY", async () => {
    await withEnvioPage(envioFixtureSection("envio-toggle-and-package"), async (page) => {
      await ensurePackageSizeIfShown(page, "BULKY")
      expect(await roleRadioIsChecked(page, "bulky")).toBe(true)
    })
  })

  it("clicks the visible peso label for the CRM tramo", async () => {
    await withEnvioPage(envioFixtureSection("envio-weight"), async (page) => {
      const label = await ensureStandardWeightBand(page, 0.5)
      expect(label).toBe("0 a 1 kg")
      expect(await page.locator("label").filter({ hasText: "0 a 1 kg" }).locator("input").isChecked()).toBe(true)
    })
  })

  it("clamps to the last visible band and does not click Delivery Option 5", async () => {
    await withEnvioPage(envioFixtureSection("envio-weight-capped"), async (page) => {
      const label = await ensureStandardWeightBand(page, 25)
      expect(label).toBe("10 a 20 kg")
      expect(
        await page.locator("label").filter({ hasText: "10 a 20 kg" }).locator("input").isChecked(),
      ).toBe(true)
      expect(await page.locator("#phantom-20-30").isChecked()).toBe(false)
    })
  })

  it("clicks 20 a 30 kg only when that label is allowed and visible", async () => {
    await withEnvioPage(envioFixtureSection("envio-weight"), async (page) => {
      const blocked = await ensureStandardWeightBand(page, 25, [
        "0 a 1 kg",
        "1 a 2 kg",
        "2 a 5 kg",
        "5 a 10 kg",
        "10 a 20 kg",
      ])
      expect(blocked).toBe("10 a 20 kg")
      expect(
        await page.locator("label").filter({ hasText: "20 a 30 kg" }).locator("input").isChecked(),
      ).toBe(false)

      await page.locator("label").filter({ hasText: "10 a 20 kg" }).locator("input").evaluate((el) => {
        if (el instanceof HTMLInputElement) el.checked = false
      })
      const allowed = await ensureStandardWeightBand(page, 25, [
        "10 a 20 kg",
        "20 a 30 kg",
      ])
      expect(allowed).toBe("20 a 30 kg")
      expect(
        await page.locator("label").filter({ hasText: "20 a 30 kg" }).locator("input").isChecked(),
      ).toBe(true)
    })
  })

  it("clicks the bidi weight label, not Delivery Option 5", async () => {
    await withEnvioPage(envioFixtureSection("envio-weight-bidi"), async (page) => {
      const label = await ensureStandardWeightBand(page, 25)
      expect(label).toBe("10 a 20 kg")
      expect(await page.locator(".DeliveryRadioOption input").isChecked()).toBe(true)
      expect(await page.locator("#phantom-20-30").isChecked()).toBe(false)
    })
  })

  it("does not publicar when a heavy band shows no Estándar or Voluminoso", async () => {
    await withEnvioPage(envioFixtureSection("envio-weight-heavy-no-size"), async (page) => {
      await expect(ensureStandardWeightBand(page, 15)).rejects.toMatchObject({
        name: "WallapopPublishError",
        keepBrowser: true,
        failListing: true,
        message: "Tras elegir 10 a 20 kg no aparecieron Estándar ni Voluminoso.",
      })
    })
  })
})

const MARCA_UPLOAD_DUMP = fs.readFileSync(
  path.join(__dirname, "fixtures/wallapop-marca-form.html"),
  "utf8",
)

async function plantBrandCatalogItem(page: Page, wanted: string) {
  await page.evaluate((brand) => {
    const box = document.querySelector('wallapop-combo-box[data-testid="brand"]')
    const listbox = box?.querySelector('[role="listbox"]')
    if (!box || !listbox) throw new Error("captured brand listbox missing")
    const item = document.createElement("wallapop-combo-box-item")
    item.setAttribute("aria-label", brand)
    item.addEventListener("click", () => {
      let hidden = document.querySelector("#brand")
      if (!(hidden instanceof HTMLInputElement)) {
        hidden = document.createElement("input")
        hidden.id = "brand"
        hidden.setAttribute("name", "brand")
        box.after(hidden)
      }
      hidden.value = brand
    })
    listbox.appendChild(item)
  }, wanted)
}

async function plantBrandCrearAndHeader(page: Page, wanted: string) {
  await page.evaluate((brand) => {
    const box = document.querySelector('wallapop-combo-box[data-testid="brand"]')
    const panel = box?.querySelector(".wallapop-combo-box__floating-area-content")
    if (!box || !panel) throw new Error("captured brand panel missing")
    const header = document.createElement("header")
    header.className = "PrivateLayout__header"
    const decoy = document.createElement("a")
    decoy.textContent = "Crear cuenta"
    decoy.addEventListener("click", () => {
      let hidden = document.querySelector("#brand")
      if (!(hidden instanceof HTMLInputElement)) {
        hidden = document.createElement("input")
        hidden.id = "brand"
        document.body.prepend(hidden)
      }
      hidden.value = "HEADER"
    })
    header.appendChild(decoy)
    document.body.prepend(header)

    const btn = document.createElement("button")
    btn.type = "button"
    btn.textContent = `Crear ${brand}`
    btn.addEventListener("click", () => {
      let hidden = document.querySelector("#brand")
      if (!(hidden instanceof HTMLInputElement)) {
        hidden = document.createElement("input")
        hidden.id = "brand"
        hidden.setAttribute("name", "brand")
        box.after(hidden)
      }
      hidden.value = brand
    })
    panel.appendChild(btn)
  }, wanted)
}

describe("Wallapop Marca DOM", () => {
  it("finds Marca* on the captured upload form", async () => {
    await withEnvioPage(MARCA_UPLOAD_DUMP, async (page) => {
      const combo = await queryMarcaCombo(page)
      expect(combo?.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      )
      expect(
        await page.locator('wallapop-combo-box[data-testid="brand"]').count(),
      ).toBe(1)
    })
  })

  it("picks a catalog item inside the captured brand listbox", async () => {
    await withEnvioPage(MARCA_UPLOAD_DUMP, async (page) => {
      await plantBrandCatalogItem(page, "QUIRUMED")
      expect(await clickMarcaCatalogItem(page, "QUIRUMED")).toBe(true)
      expect(await readBrandValue(page)).toBe("QUIRUMED")
    })
  })

  it("clicks Crear in the captured panel, not the layout header", async () => {
    await withEnvioPage(MARCA_UPLOAD_DUMP, async (page) => {
      await plantBrandCrearAndHeader(page, "QUIRUMED")
      const result = await clickMarcaCrearOption(page, "QUIRUMED")
      expect(result.clicked).toBe(true)
      expect(result.text).toMatch(/Crear QUIRUMED/i)
      expect(await readBrandValue(page)).toBe("QUIRUMED")
    })
  })
})

describe("upload vertical choice", () => {
  it("clicks Algo que ya no necesito when aria-label is Consumer Goods Vertical", async () => {
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setContent(`<!DOCTYPE html><body>
        <button aria-label="Jobs Vertical" class="UploadStepVertical__singleIcon">Empleo</button>
        <button id="cg" aria-label="Consumer Goods Vertical" class="UploadStepVertical__multiIcons">
          <span class="UploadStepVertical__multiIcons__title">Algo que ya no necesito</span>
        </button>
      </body>`)
      await page.locator("#cg").evaluate((el) => {
        el.addEventListener("click", () => {
          el.setAttribute("data-clicked", "1")
        })
      })
      await selectConsumerGoods(page, () => undefined)
      expect(await page.locator("#cg").getAttribute("data-clicked")).toBe("1")
    } finally {
      await browser.close()
    }
  })

  it("does not touch the header search when SearchOverlay is absent", async () => {
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setContent(
        `<!DOCTYPE html><body><input name="search" id="q"></body>`,
      )
      await page.evaluate(() => {
        document
          .querySelector("#q")
          ?.addEventListener("input", () => {
            document.body.dataset.searchInput = "1"
          })
      })
      await dismissSearchOverlay(page)
      expect(
        await page.evaluate(() => document.body.dataset.searchInput ?? ""),
      ).toBe("")
    } finally {
      await browser.close()
    }
  })
})

describe("upload Color field", () => {
  it("continues when Wallapop never shows Color", async () => {
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setContent(
        `<!DOCTYPE html><body><section>Envío Estado</section></body>`,
      )
      await expect(
        ensureExtraUploadFields(page, [colorField], { color: ["black"] }),
      ).resolves.toBeUndefined()
    } finally {
      await browser.close()
    }
  }, 15_000)

  it("selects Negro and clicks the shadow Seleccionar button", async () => {
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setContent(`<!DOCTYPE html><body id="root"></body>`)
      const done = ensureExtraUploadFields(page, [colorField], {
        color: ["black"],
      })
      await page.waitForTimeout(800)
      await page.evaluate((html) => {
        document.body.insertAdjacentHTML("beforeend", html)
        const button = document.querySelector("#ok")
        if (!button) return
        const root = button.attachShadow({ mode: "open" })
        root.innerHTML = "<span>Seleccionar</span>"
        button.addEventListener("click", () => {
          button.setAttribute("data-clicked", "1")
        })
      }, COLOR_LIST_HTML)
      await done
      expect(await page.locator("#ok").getAttribute("data-clicked")).toBe("1")
    } finally {
      await browser.close()
    }
  })

  it("clicks Negro by aria-label even with a leftover input#black", async () => {
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setContent(`<!DOCTYPE html><body>
        <div class="walla-dropdown__floating-area" style="display:block;width:0;height:0;overflow:hidden">
          <walla-dropdown-item role="option" aria-label="ghost"><input id="black"></walla-dropdown-item>
        </div>
        <walla-dropdown data-testid="color">
          <div role="button" aria-label="Color">Color*</div>
          <div class="walla-dropdown__floating-area" style="display:block;height:220px;width:320px">
            <walla-button id="clear">Borrar</walla-button>
            <walla-dropdown-item role="option" aria-label="Negro" style="display:block;height:40px">
              <input name="black" type="checkbox">Negro
            </walla-dropdown-item>
            <walla-dropdown-item role="option" aria-label="Blanco" aria-selected="true" style="display:block;height:40px">
              <input id="white" type="checkbox" checked>Blanco
            </walla-dropdown-item>
            <walla-button id="ok">Seleccionar</walla-button>
          </div>
        </walla-dropdown>
        <script>
          document.querySelector('[aria-label="Negro"]').addEventListener("click", (event) => {
            const item = event.currentTarget
            item.setAttribute("aria-selected", "true")
            item.querySelector("input").checked = true
          })
          document.getElementById("ok").addEventListener("click", () => {
            document.getElementById("ok").setAttribute("data-clicked", "1")
          })
        </script>
      </body>`)
      await expect(
        ensureExtraUploadFields(page, [colorField], { color: ["black"] }),
      ).resolves.toBeUndefined()
      expect(
        await page.locator('[aria-label="Negro"]').getAttribute("aria-selected"),
      ).toBe("true")
    } finally {
      await browser.close()
    }
  })

  it("accepts Negro when the list closes without Seleccionar", async () => {
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setContent(`<!DOCTYPE html><body>
        <walla-dropdown data-testid="color">
          <div role="button" id="color-btn" aria-label="Color">Color*</div>
          <div class="walla-dropdown__floating-area" style="display:block;height:80px">
            <walla-dropdown-item role="option" aria-label="Negro" style="display:block;height:40px">
              <input id="black" type="checkbox">Negro
            </walla-dropdown-item>
          </div>
        </walla-dropdown>
        <script>
          document.querySelector('[role="option"]').addEventListener("click", () => {
            document.getElementById("color-btn").setAttribute("aria-label", "Color, Negro")
            document.querySelector(".walla-dropdown__floating-area")?.remove()
          })
        </script>
      </body>`)
      await expect(
        ensureExtraUploadFields(page, [colorField], { color: ["black"] }),
      ).resolves.toBeUndefined()
    } finally {
      await browser.close()
    }
  })

  it("still fails when Color is open but Negro is not in the list", async () => {
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setContent(`<!DOCTYPE html><body>
        <walla-dropdown data-testid="color">
          <div role="button">Color*</div>
          <div class="walla-dropdown__floating-area" style="display:block;height:40px">
            <walla-dropdown-item role="option" aria-label="Blanco" style="display:block;height:40px">
              <input id="white" type="checkbox">
            </walla-dropdown-item>
          </div>
        </walla-dropdown>
      </body>`)
      await expect(
        ensureExtraUploadFields(page, [colorField], { color: ["black"] }),
      ).rejects.toBeInstanceOf(WallapopPublishError)
    } finally {
      await browser.close()
    }
  })

  it("still fails when a required field other than Color is missing", async () => {
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setContent(`<!DOCTYPE html><body></body>`)
      const material: CategoryUploadField = {
        ...colorField,
        id: "material",
        label: "Material",
        options: [{ id: "other", title: "Otro" }],
      }
      await expect(
        ensureExtraUploadFields(page, [material], { material: ["other"] }),
      ).rejects.toBeInstanceOf(WallapopPublishError)
    } finally {
      await browser.close()
    }
  })
})

const CATEGORY_DRILL_HTML = `<!DOCTYPE html><body>
  <h1>Selecciona una categoría</h1>
  <div id="section">
    <walla-dropdown>
      <div class="walla-dropdown__inner-input" role="button" id="cat-button" aria-label="Categoría y subcategoría, Sillas gaming" style="display:block;height:40px">
        <span class="subText">Tecnología y electrónica > Gaming: consolas y videojuegos > PC gaming y streaming</span>
      </div>
    </walla-dropdown>
    <div id="panel"></div>
  </div>
  <input id="category_leaf_id" value="24121">
  <script>
    const levels = {
      root: ["Hogar y jardín", "Motos"],
      hogar: ["Muebles y organización", "Baño"],
      muebles: ["Sillas y taburetes", "Puffs"],
    }
    const button = document.getElementById("cat-button")
    const panel = document.getElementById("panel")
    const leaf = document.getElementById("category_leaf_id")
    function render(names) {
      panel.innerHTML = '<div role="listbox" style="display:block;height:120px;overflow:auto">' +
        names.map((name) =>
          '<walla-dropdown-item role="option" aria-label="' + name + '" style="display:block;height:36px">' + name + '</walla-dropdown-item>'
        ).join("") +
        "</div>"
    }
    document.querySelector("walla-dropdown").addEventListener("click", () => {
      if (!panel.querySelector('[role="listbox"]')) render(levels.root)
    })
    panel.addEventListener("click", (event) => {
      const item = event.target.closest("walla-dropdown-item")
      if (!item) return
      const name = item.getAttribute("aria-label")
      if (name === "Hogar y jardín") render(levels.hogar)
      else if (name === "Muebles y organización") render(levels.muebles)
      else if (name === "Sillas y taburetes") {
        button.textContent = "Hogar y jardín > Muebles y organización"
        leaf.value = "24221"
      }
    })
  </script>
</body>`

describe("category drill", () => {
  it("walks past a suggested gaming chair to Sillas y taburetes", async () => {
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setContent(CATEGORY_DRILL_HTML)
      await ensureCategorySelected(page, [
        "Hogar y jardín",
        "Muebles y organización",
        "Sillas y taburetes",
      ])
      expect(await page.locator("#category_leaf_id").inputValue()).toBe("24221")
    } finally {
      await browser.close()
    }
  })

  it("clicks Aire acondicionado even when CRM nameEs has a trailing space", async () => {
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setContent(`<!DOCTYPE html><body>
        <h1>Selecciona una categoría</h1>
        <walla-dropdown>
          <div class="walla-dropdown__inner-input" role="button" id="cat-button" aria-label="Categoría y subcategoría" style="display:block;height:40px"></div>
        </walla-dropdown>
        <div role="listbox" style="display:block;height:200px;overflow:auto;width:320px">
          <walla-dropdown-item role="option" aria-label="Chimeneas, Estufas y radiadores" style="display:block;height:36px">Chimeneas, Estufas y radiadores</walla-dropdown-item>
          <walla-dropdown-item role="option" aria-label="Aire acondicionado y ventiladores" style="display:block;height:36px">Aire acondicionado y ventiladores</walla-dropdown-item>
          <walla-dropdown-item role="option" aria-label="Combustibles y pellet" style="display:block;height:36px">Combustibles y pellet</walla-dropdown-item>
        </div>
        <input id="category_leaf_id" value="">
        <script>
          document.querySelector('[role="listbox"]').addEventListener("click", (event) => {
            const item = event.target.closest("walla-dropdown-item")
            if (!item || item.getAttribute("aria-label") !== "Aire acondicionado y ventiladores") return
            document.getElementById("cat-button").setAttribute(
              "aria-label",
              "Categoría y subcategoría, Aire acondicionado y ventiladores",
            )
            document.getElementById("category_leaf_id").value = "24280"
            item.closest("[role=listbox]").remove()
          })
        </script>
      </body>`)
      await ensureCategorySelected(page, [
        "Hogar y jardín",
        "Calefacción y climatización",
        "Aire acondicionado y ventiladores ",
      ])
      expect(await page.locator("#category_leaf_id").inputValue()).toBe("24280")
    } finally {
      await browser.close()
    }
  })

  it("clicks the last row inside a short overflow list", async () => {
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      const rows = [
        "Menaje para cocinar, comer y beber",
        "Picas y muebles cocina",
        "Grifería de cocina",
        "Textiles de cocina y comedor",
        "Accesorios",
      ]
      await page.setContent(`<!DOCTYPE html><body>
        <h1>Selecciona una categoría</h1>
        <walla-dropdown>
          <div class="walla-dropdown__inner-input" role="button" id="cat-button" aria-label="Categoría y subcategoría, Purificador y humificador" style="display:block;height:40px">
            <span class="subText">Hogar y jardín > Calefacción y climatización</span>
          </div>
        </walla-dropdown>
        <div role="listbox" style="display:block;height:72px;overflow:auto;width:280px">
          ${rows
            .map(
              (name) =>
                `<walla-dropdown-item role="option" aria-label="${name}" style="display:block;height:36px">${name}</walla-dropdown-item>`,
            )
            .join("")}
        </div>
        <input id="category_leaf_id" value="24266">
        <script>
          document.querySelector('[role="listbox"]').addEventListener("click", (event) => {
            const item = event.target.closest("walla-dropdown-item")
            if (!item || item.getAttribute("aria-label") !== "Accesorios") return
            const btn = document.getElementById("cat-button")
            btn.setAttribute("aria-label", "Categoría y subcategoría, Accesorios")
            const sub = btn.querySelector("span.subText")
            if (sub) sub.textContent = "Hogar y jardín > Cocina"
            document.getElementById("category_leaf_id").value = "24299"
            item.closest("[role=listbox]").remove()
          })
        </script>
      </body>`)
      await ensureCategorySelected(page, [
        "Hogar y jardín",
        "Cocina",
        "Accesorios",
      ])
      expect(await page.locator("#category_leaf_id").inputValue()).toBe("24299")
    } finally {
      await browser.close()
    }
  })

  it("ignores a leftover 0-size listbox in front of the painted menu", async () => {
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setContent(`<!DOCTYPE html><body>
        <h1>Selecciona una categoría</h1>
        <walla-dropdown>
          <div class="walla-dropdown__inner-input" role="button" id="cat-button" aria-label="Categoría y subcategoría" style="display:block;height:40px"></div>
        </walla-dropdown>
        <div role="listbox" style="width:1px;height:1px;overflow:hidden;position:absolute;left:-800px;top:0">
          <walla-dropdown-item role="option" aria-label="Accesorios" style="display:block;height:36px">Accesorios</walla-dropdown-item>
        </div>
        <div id="panel"></div>
        <input id="category_leaf_id" value="">
        <script>
          const panel = document.getElementById("panel")
          const button = document.getElementById("cat-button")
          const leaf = document.getElementById("category_leaf_id")
          function render(names) {
            panel.innerHTML = '<div role="listbox" style="display:block;height:120px;overflow:auto">' +
              names.map((name) =>
                '<walla-dropdown-item role="option" aria-label="' + name + '" style="display:block;height:36px">' + name + '</walla-dropdown-item>'
              ).join("") +
              "</div>"
          }
          document.querySelector("walla-dropdown").addEventListener("click", () => {
            if (!panel.querySelector('[role="listbox"]')) render(["Hogar y jardín", "Motos"])
          })
          panel.addEventListener("click", (event) => {
            const item = event.target.closest("walla-dropdown-item")
            if (!item) return
            const name = item.getAttribute("aria-label")
            if (name === "Hogar y jardín") render(["Cocina", "Baño"])
            else if (name === "Cocina") render(["Accesorios"])
            else if (name === "Accesorios") {
              button.textContent = "Hogar y jardín > Cocina"
              leaf.value = "24299"
            }
          })
        </script>
      </body>`)
      await ensureCategorySelected(page, [
        "Hogar y jardín",
        "Cocina",
        "Accesorios",
      ])
      expect(await page.locator("#category_leaf_id").inputValue()).toBe("24299")
    } finally {
      await browser.close()
    }
  })

  it("rejects a filled picker that is still the suggested category", async () => {
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setContent(`<!DOCTYPE html><body>
        <h1>Selecciona una categoría</h1>
        <walla-dropdown>
          <div class="walla-dropdown__inner-input" role="button" aria-label="Categoría y subcategoría, Sillas gaming" style="display:block;height:40px">
            <span class="subText">Tecnología y electrónica > Gaming: consolas y videojuegos > PC gaming y streaming</span>
          </div>
        </walla-dropdown>
        <div role="listbox" style="display:block;height:80px">
          <walla-dropdown-item role="option" aria-label="Motos" style="display:block;height:36px">Motos</walla-dropdown-item>
        </div>
        <input id="category_leaf_id" value="24121">
      </body>`)
      await expect(
        ensureCategorySelected(page, ["Hogar y jardín", "Sillas y taburetes"]),
      ).rejects.toThrow(/Sillas gaming/)
    } finally {
      await browser.close()
    }
  })
})
