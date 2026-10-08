import fs from "node:fs"
import path from "node:path"

import { chromium, type Page } from "playwright"
import { describe, expect, it } from "vitest"

import { productListingApiPutBodySchema } from "../../lib/validations/listing"
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
  queryMarcaCombo,
  readBrandValue,
  isWallapopPublishedCatalogUrl,
  listingUrlFromPageUrl,
  normalizePublishTitle,
  parseCatalogPriceEur,
  pickUniqueCatalogItemUrl,
  PUBLISHED_CATALOG_ITEMS_EVAL,
  readLandingAfterPublicarClick,
  readUrlAfterPublicarClick,
  roleRadioIsChecked,
  type PublishedCatalogItem,
} from "../src/lib/wallapop-publish"
import { shouldRevertPublishClaim } from "../src/routes/product-publish"

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

  it("selects Delivery Option N for the CRM peso tramo", async () => {
    await withEnvioPage(envioFixtureSection("envio-weight"), async (page) => {
      const label = await ensureStandardWeightBand(page, 0.5)
      expect(label).toBe("0 a 1 kg")
      expect(await roleRadioIsChecked(page, "Delivery Option 0")).toBe(true)
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
