import fs from "node:fs"
import path from "node:path"

import { chromium } from "playwright"
import { describe, expect, it } from "vitest"

import { wallapopItemPathKey } from "../../lib/inventory/wallapop-item-url"
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
})
