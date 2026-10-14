import { describe, expect, it } from "vitest"

import {
  parseSellerItemsPayload,
  sellerUserIdFromItemHtml,
} from "../src/lib/wallapop-live-catalog"
import { planLiveMarks, type CrmLiveRow } from "../src/lib/wallapop-live-mark"
import type { LiveCatalogItem } from "../src/lib/wallapop-live-catalog"

function row(partial: Partial<CrmLiveRow> & Pick<CrmLiveRow, "listingId" | "sku" | "title">): CrmLiveRow {
  return {
    price: 19.99,
    productStatus: "ACTIVE",
    listingStatus: "READY_TO_POST",
    externalUrl: null,
    ...partial,
  }
}

function item(partial: Partial<LiveCatalogItem> & Pick<LiveCatalogItem, "href" | "title">): LiveCatalogItem {
  return {
    id: "id",
    price: 19.99,
    priceText: "19,99",
    reserved: false,
    ...partial,
  }
}

describe("planLiveMarks", () => {
  it("links a queued row to the live item with the same title and price", () => {
    const marks = planLiveMarks(
      [row({ listingId: "hanger", sku: "7", title: "Pack de 12 perchas 45 cm", listingStatus: "FAILED" })],
      [item({ href: "https://es.wallapop.com/item/pack-de-12-perchas-45-cm-1312856751", title: "Pack de 12 perchas 45 cm" })],
    )
    expect(marks[0]).toMatchObject({
      action: "hanging",
      sku: "7",
      status: "ACTIVE",
      reason: "title",
      externalUrl: "https://es.wallapop.com/item/pack-de-12-perchas-45-cm-1312856751",
    })
  })

  it("leaves a reserved listing whose public url is still up", () => {
    const href = "https://es.wallapop.com/item/lampara-escritorio-1307308862"
    const marks = planLiveMarks(
      [row({ listingId: "lamp", sku: "WP-098821", title: "Lámpara", listingStatus: "RESERVED", externalUrl: href })],
      [item({ href, title: "Otra", reserved: false })],
    )
    expect(marks[0]).toMatchObject({ action: "leave", reason: "already" })
  })

  it("leaves a live listing that is already marked the same way", () => {
    const href = "https://es.wallapop.com/item/sarten-1312831557"
    const marks = planLiveMarks(
      [row({ listingId: "pan", sku: "50", title: "Sartén", listingStatus: "ACTIVE", externalUrl: href })],
      [item({ href, title: "Sartén" })],
    )
    expect(marks[0]).toMatchObject({ action: "leave", reason: "already" })
  })

  it("marks an active listing missing from the catalog as not hanging", () => {
    const marks = planLiveMarks(
      [row({
        listingId: "gone",
        sku: "WP-1",
        title: "Producto ausente",
        listingStatus: "ACTIVE",
        externalUrl: "https://es.wallapop.com/item/producto-ausente-111",
      })],
      [item({ href: "https://es.wallapop.com/item/otro-222", title: "Otro producto distinto" })],
    )
    expect(marks[0]).toMatchObject({ action: "not_hanging", sku: "WP-1" })
  })

  it("does not revive a sold product or a row still posting", () => {
    const href = "https://es.wallapop.com/item/vendido-333"
    const marks = planLiveMarks(
      [
        row({ listingId: "sold", sku: "S", title: "Vendido", productStatus: "SOLD", listingStatus: "DEACTIVATED", externalUrl: href }),
        row({ listingId: "posting", sku: "P", title: "En curso", listingStatus: "POSTING" }),
      ],
      [item({ href, title: "Vendido" }), item({ href: "https://es.wallapop.com/item/en-curso-444", title: "En curso" })],
    )
    expect(marks.find((mark) => mark.sku === "S")).toMatchObject({ action: "leave", reason: "product_not_active" })
    expect(marks.find((mark) => mark.sku === "P")).toMatchObject({ action: "leave", reason: "posting" })
  })

  it("does not give one live item to two CRM rows", () => {
    const marks = planLiveMarks(
      [
        row({ listingId: "a", sku: "A", title: "Misma pieza" }),
        row({ listingId: "b", sku: "B", title: "Misma pieza" }),
      ],
      [item({ href: "https://es.wallapop.com/item/misma-pieza-555", title: "Misma pieza" })],
    )
    const hanging = marks.filter((mark) => mark.action === "hanging")
    expect(hanging).toHaveLength(1)
    expect(hanging[0]).toMatchObject({ sku: "A" })
    expect(marks.find((mark) => mark.sku === "B")).toMatchObject({ action: "leave", reason: "not_listed" })
  })
})

describe("parseSellerItemsPayload", () => {
  it("reads the public seller page and the next cursor", () => {
    const parsed = parseSellerItemsPayload({
      data: [{
        id: "abc",
        title: "Pack de 12 perchas 45 cm",
        slug: "pack-de-12-perchas-45-cm-1312856751",
        price: { cash: { amount: 19.99, currency: "EUR" } },
        isReserved: false,
      }],
      meta: { next: "cursor" },
    })
    expect(parsed.next).toBe("cursor")
    expect(parsed.items[0]).toMatchObject({
      href: "https://es.wallapop.com/item/pack-de-12-perchas-45-cm-1312856751",
      price: 19.99,
      reserved: false,
    })
  })

  it("reads the seller id from an item page", () => {
    expect(sellerUserIdFromItemHtml('{"userId":"wzynvgk152j5"}')).toBe("wzynvgk152j5")
  })
})
