import fs from "node:fs"
import path from "node:path"

import { chromium } from "playwright"
import { describe, expect, it } from "vitest"

import {
  wallapopItemPathKey,
  wallapopItemSlugHrefOrNull,
} from "../../lib/inventory/wallapop-item-url"
import {
  CATALOG_TITLE_CARDS_EVAL,
  planTitleUrlLinks,
  rankCatalogCardsForListing,
} from "../src/lib/wallapop-monitor/link-by-title"
import {
  parseLlmPick,
  planCombinedTitleUrlLinks,
} from "../src/lib/wallapop-monitor/link-by-title-llm"
import {
  planItemPageUrlLinks,
  rankListingsForItemPage,
} from "../src/lib/wallapop-monitor/link-by-item-page"
import {
  planMonitorUpdates,
  PUBLISHED_CATALOG_ROWS_EVAL,
} from "../src/lib/wallapop-monitor"
import { parseSnapshotText } from "../scripts/apply-catalog-url-snapshot"

const ARMARIO = "https://es.wallapop.com/item/armario-escobero-1308052780"
const SILLA = "https://es.wallapop.com/item/silla-oficina-1310000001"
const MESA =
  "https://es.wallapop.com/item/mesa-auxiliar-cama-teqler-regulable-1310760208"

describe("planMonitorUpdates", () => {
  const listings = [
    {
      id: "l-armario",
      productId: "p-armario",
      status: "ACTIVE",
      externalUrl: ARMARIO,
    },
    {
      id: "l-silla",
      productId: "p-silla",
      status: "RESERVED",
      externalUrl: SILLA,
    },
    {
      id: "l-mesa",
      productId: "p-mesa",
      status: "ACTIVE",
      externalUrl: MESA,
    },
  ]

  it("sets RESERVED from badge and ACTIVE when the badge is gone", () => {
    const plan = planMonitorUpdates(
      [
        { href: ARMARIO, reserved: true },
        { href: SILLA, reserved: false },
      ],
      [],
      listings,
    )
    expect(plan.toReserved).toEqual(["l-armario"])
    expect(plan.toActive).toEqual(["l-silla"])
    expect(plan.toSoldProductIds).toEqual([])
  })

  it("marks sold by /item/ href, not title, and sold wins over reserved", () => {
    const plan = planMonitorUpdates(
      [{ href: MESA, reserved: true }],
      [{ href: MESA, sold: true }],
      listings,
    )
    expect(plan.toSoldProductIds).toEqual(["p-mesa"])
    expect(plan.toReserved).toEqual([])
    expect(
      planMonitorUpdates(
        [],
        [{ href: MESA, sold: true }],
        [
          {
            id: "l-title-only",
            productId: "p-title",
            status: "ACTIVE",
            externalUrl: null,
          },
        ],
      ).toSoldProductIds,
    ).toEqual([])
  })

  it("does not change listings that were not seen in either catalog", () => {
    const plan = planMonitorUpdates([], [], listings)
    expect(plan.toReserved).toEqual([])
    expect(plan.toActive).toEqual([])
    expect(plan.toSoldProductIds).toEqual([])
  })

  it("logs catalog hrefs that are not in CRM instead of auto-SOLD", () => {
    const plan = planMonitorUpdates(
      [{ href: "https://es.wallapop.com/item/orphan-9", reserved: true }],
      [{ href: "https://es.wallapop.com/item/sold-orphan-8", sold: true }],
      listings,
    )
    expect(plan.orphanPublished).toHaveLength(1)
    expect(plan.orphanSold).toHaveLength(1)
    expect(plan.toSoldProductIds).toEqual([])
    expect(plan.toReserved).toEqual([])
  })
})

describe("published catalog DOM", () => {
  it("treats wallapop-badge reserved as reserved, not btn-reserve", async () => {
    const html = fs.readFileSync(
      path.join(__dirname, "fixtures/wallapop-catalog-published.html"),
      "utf8",
    )
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setContent(html)
      await page.evaluate(`(() => {
        const host = document.querySelector("#shadow-host")
        if (!host || host.shadowRoot) return
        const root = host.attachShadow({ mode: "open" })
        root.innerHTML = '<wallapop-badge badgetype="reserved" class="reserved"></wallapop-badge>'
      })()`)
      const rows = (await page.evaluate(PUBLISHED_CATALOG_ROWS_EVAL)) as {
        href: string
        reserved: boolean
      }[]
      const byKey = new Map(
        rows.map((row) => [wallapopItemPathKey(row.href), row.reserved]),
      )
      expect(byKey.get(wallapopItemPathKey(ARMARIO))).toBe(true)
      expect(byKey.get(wallapopItemPathKey(SILLA))).toBe(false)
      expect(byKey.get(wallapopItemPathKey(MESA))).toBe(true)
    } finally {
      await browser.close()
    }
  })

  it("reads card titles from info-title", async () => {
    const html = fs.readFileSync(
      path.join(__dirname, "fixtures/wallapop-catalog-published.html"),
      "utf8",
    )
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setContent(html)
      const rows = (await page.evaluate(CATALOG_TITLE_CARDS_EVAL)) as {
        href: string
        title: string
      }[]
      expect(
        rows.find((row) => wallapopItemPathKey(row.href) === wallapopItemPathKey(ARMARIO))
          ?.title,
      ).toBe("Armario Escobero Exterior Plastico")
    } finally {
      await browser.close()
    }
  })
})

describe("parseSnapshotText", () => {
  it("reads MATCH lines from a dry-run paste", () => {
    const rows = parseSnapshotText(
      `MATCH  RULE  J  Ventilador  ->  https://es.wallapop.com/item/ventilador-rowenta-70w-blanco-1307308381
MATCH  LLM  WP-408492  Lionelo  ->  https://es.wallapop.com/item/barrera-seguridad-ninos-lionelo-truus-slim-1309522264`,
    )
    expect(rows).toHaveLength(2)
    expect(rows[1]?.sku).toBe("WP-408492")
    expect(rows[1]?.href).toContain("lionelo-truus-slim")
  })
})

describe("wallapopItemSlugHrefOrNull", () => {
  it("rejects site root and bare /item/", () => {
    expect(wallapopItemSlugHrefOrNull("https://es.wallapop.com/")).toBeNull()
    expect(wallapopItemSlugHrefOrNull("https://es.wallapop.com/item/")).toBeNull()
  })

  it("accepts a normal listing slug", () => {
    expect(
      wallapopItemSlugHrefOrNull(
        "https://es.wallapop.com/item/caseta-jardin-metal-8x4-gris-1308045379",
      ),
    ).toContain("/item/caseta-jardin-metal-8x4-gris-1308045379")
  })
})

describe("parseLlmPick", () => {
  it("accepts a high-confidence index", () => {
    expect(
      parseLlmPick({
        match: true,
        candidateIndex: 2,
        confidence: "high",
        reason: "Mismo modelo Keter",
      }),
    ).toEqual({
      match: true,
      candidateIndex: 2,
      confidence: "high",
      reason: "Mismo modelo Keter",
    })
  })
})

describe("planItemPageUrlLinks", () => {
  it("links duplicate CRM titles using the item-page description", async () => {
    const hrefA =
      "https://es.wallapop.com/item/sarten-tefal-28-roja-1310000001"
    const hrefB =
      "https://es.wallapop.com/item/sarten-tefal-24-negra-1310000002"
    const twins = [
      {
        listingId: "l-red",
        sku: "WP-RED",
        title: "Sartén Tefal",
        description: "Sartén Tefal 28 cm antiadherente color rojo",
        externalUrl: null,
        status: "ACTIVE",
        priceEur: 25,
      },
      {
        listingId: "l-black",
        sku: "WP-BLACK",
        title: "Sartén Tefal",
        description: "Sartén Tefal 24 cm antiadherente color negro",
        externalUrl: null,
        status: "ACTIVE",
        priceEur: 22,
      },
    ]
    const ranked = rankListingsForItemPage(
      {
        href: hrefA,
        title: "Sarten Tefal 28 Roja",
        description: "Color rojo 28 cm antiadherente",
        priceText: "25 €",
      },
      twins,
      2,
    )
    expect(ranked[0]?.sku).toBe("WP-RED")

    const plan = await planItemPageUrlLinks(
      twins,
      [
        {
          href: hrefA,
          title: "Sarten Tefal 28 Roja",
          description: "Color rojo 28 cm",
          priceText: "25 €",
        },
        {
          href: hrefB,
          title: "Sarten Tefal 24 Negra",
          description: "Color negro 24 cm",
          priceText: "22 €",
        },
      ],
      {
        delayMs: 0,
        ask: async (facts) => ({
          match: true,
          candidateIndex: 0,
          confidence: "high",
          reason: facts.title.includes("Roja") ? "roja 28" : "negra 24",
        }),
      },
    )
    expect(plan.links).toHaveLength(2)
    expect(plan.links.map((row) => row.sku).sort()).toEqual([
      "WP-BLACK",
      "WP-RED",
    ])
  })

  it("does not steal a URL already stored on another listing", async () => {
    const href = "https://es.wallapop.com/item/casco-ls2-advant-1309517660"
    const plan = await planItemPageUrlLinks(
      [
        {
          listingId: "l-taken",
          sku: "WP-TAKEN",
          title: "Casco LS2 Advant",
          description: "Casco de moto XL Advant carbono LS2",
          externalUrl: href,
          status: "RESERVED",
          priceEur: 199,
        },
        {
          listingId: "l-open",
          sku: "WP-OPEN",
          title: "Casco LS2 Advant",
          description: "Otro casco LS2",
          externalUrl: null,
          status: "ACTIVE",
          priceEur: 199,
        },
      ],
      [
        {
          href,
          title: "Casco LS2 Advant carbono",
          description: "Casco de moto XL Advant carbono LS2",
          priceText: "199 €",
        },
      ],
      {
        delayMs: 0,
        ask: async () => {
          throw new Error("should not call Groq for an already-linked URL")
        },
      },
    )
    expect(plan.links).toEqual([])
    expect(plan.alreadyLinked).toBe(1)
  })
})

describe("planCombinedTitleUrlLinks", () => {
  it("adds an LLM link when rules miss but Groq is certain", async () => {
    const href =
      "https://es.wallapop.com/item/keter-caseta-jardin-2m2-exterior-1308376298"
    const plan = await planCombinedTitleUrlLinks(
      [
        {
          listingId: "l1",
          sku: "WP-793104",
          title: "Keter 6x3 caseta de jardín cobertizo 2m2",
          externalUrl: null,
          status: "ACTIVE",
          priceEur: 199,
        },
      ],
      [
        {
          href,
          title: "Caseta jardin Keter 2m2 exterior",
          priceText: "199 €",
        },
      ],
      {
        delayMs: 0,
        ask: async () => ({
          match: true,
          candidateIndex: 0,
          confidence: "high",
          reason: "Misma caseta Keter 2m2",
        }),
      },
    )
    expect(plan.links).toHaveLength(1)
    expect(plan.links[0]?.source).toBe("llm")
    expect(plan.links[0]?.href).toBe(href)
  })
})

describe("rankCatalogCardsForListing", () => {
  it("prefers cards that share more tokens with the CRM title", () => {
    const ranked = rankCatalogCardsForListing(
      "Keter caseta jardin 2m2",
      [
        { href: "https://es.wallapop.com/item/unrelated-chair-1", title: "Silla" },
        {
          href: "https://es.wallapop.com/item/keter-caseta-2m2-2",
          title: "Caseta Keter 2m2",
        },
      ],
      2,
    )
    expect(ranked[0]?.title).toContain("Keter")
  })
})

describe("planTitleUrlLinks", () => {
  it("links only an exact unique title to a catalog href", () => {
    const plan = planTitleUrlLinks(
      [
        {
          listingId: "l1",
          sku: "SKU-1",
          title: "  Armario Escobero Exterior Plastico ",
          externalUrl: null,
        },
        {
          listingId: "l2",
          sku: "SKU-2",
          title: "Other",
          externalUrl: null,
        },
        {
          listingId: "l3",
          sku: "SKU-3",
          title: "Already linked",
          externalUrl: ARMARIO,
        },
      ],
      [
        {
          href: ARMARIO,
          title: "Armario Escobero Exterior Plastico",
        },
      ],
    )
    expect(plan.links).toEqual([
      {
        listingId: "l1",
        sku: "SKU-1",
        title: "  Armario Escobero Exterior Plastico ",
        href: ARMARIO,
      },
    ])
    expect(plan.skips.some((skip) => skip.sku === "SKU-2")).toBe(true)
    expect(plan.links.some((link) => link.listingId === "l3")).toBe(false)
  })

  it("links a truncated catalog title to the full CRM title", () => {
    const plan = planTitleUrlLinks(
      [
        {
          listingId: "l-tapa",
          sku: "WP-1",
          title: "Tapa Asiento WC Cuadrado Blanco/Morado",
          externalUrl: null,
        },
      ],
      [
        {
          href: "https://es.wallapop.com/item/tapa-asiento-wc-cuadrado-blanco-morado-1311046565",
          title: "Tapa Asiento WC Cuadrado B...",
        },
      ],
    )
    expect(plan.links).toHaveLength(1)
    expect(plan.links[0]?.listingId).toBe("l-tapa")
  })

  it("links when Wallapop reorders words and ellipsizes the card", () => {
    const plan = planTitleUrlLinks(
      [
        {
          listingId: "l-meross",
          sku: "WP-634117",
          title: "Lámpara led inteligente Meross",
          externalUrl: null,
        },
      ],
      [
        {
          href: "https://es.wallapop.com/item/lampara-led-meross-inteligente-130634117",
          title: "Lámpara LED Meross Intellige...",
        },
      ],
    )
    expect(plan.links).toHaveLength(1)
    expect(plan.links[0]?.listingId).toBe("l-meross")
  })

  it("does not prefix-match a short catalog label", () => {
    const plan = planTitleUrlLinks(
      [
        {
          listingId: "l-silla",
          sku: "WP-2",
          title: "Silla de Paseo hauck Citi Neo II",
          externalUrl: null,
        },
      ],
      [{ href: SILLA, title: "Silla..." }],
    )
    expect(plan.links).toEqual([])
    expect(plan.skips[0]?.reason).toBe("no_match")
  })

  it("ignores Listo para publicar even when the catalog title matches", () => {
    const plan = planTitleUrlLinks(
      [
        {
          listingId: "l-queue",
          sku: "WP-QUEUE",
          title: "Armario Escobero Exterior Plastico",
          externalUrl: null,
          status: "READY_TO_POST",
        },
        {
          listingId: "l-live",
          sku: "WP-LIVE",
          title: "Armario Escobero Exterior Plastico",
          externalUrl: null,
          status: "ACTIVE",
        },
      ],
      [{ href: ARMARIO, title: "Armario Escobero Exterior Plastico" }],
    )
    expect(plan.links).toEqual([
      {
        listingId: "l-live",
        sku: "WP-LIVE",
        title: "Armario Escobero Exterior Plastico",
        href: ARMARIO,
      },
    ])
    expect(plan.skips.some((skip) => skip.sku === "WP-QUEUE")).toBe(false)
  })

  it("does not link duplicate titles", () => {
    const plan = planTitleUrlLinks(
      [
        {
          listingId: "a",
          sku: "A",
          title: "Silla",
          externalUrl: null,
        },
        {
          listingId: "b",
          sku: "B",
          title: "Silla",
          externalUrl: null,
        },
      ],
      [{ href: SILLA, title: "Silla" }],
    )
    expect(plan.links).toEqual([])
    expect(plan.skips.every((skip) => skip.reason === "duplicate_crm")).toBe(
      true,
    )
  })
})
