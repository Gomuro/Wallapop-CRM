import fs from "node:fs"
import path from "node:path"

import { chromium } from "playwright"
import { describe, expect, it } from "vitest"

import { wallapopItemPathKey } from "../../lib/inventory/wallapop-item-url"
import {
  CATALOG_TITLE_CARDS_EVAL,
  planTitleUrlLinks,
} from "../src/lib/wallapop-monitor/link-by-title"
import {
  planMonitorUpdates,
  PUBLISHED_CATALOG_ROWS_EVAL,
} from "../src/lib/wallapop-monitor"

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
