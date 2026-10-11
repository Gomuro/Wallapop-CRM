import fs from "node:fs"
import path from "node:path"

import { chromium, type Page } from "playwright"
import { afterEach, describe, expect, it } from "vitest"

import {
  canEliminarOnWallapop,
  canRequeueListing,
} from "../../lib/inventory/listing-active"
import type { InventoryProduct } from "../../lib/inventory/types"
import {
  isBrowserBusyError,
  isBrowserEliminarBusy,
  isBrowserSoldBusy,
  resetWallapopPublishAbortForTests,
  runWithBrowserBusy,
} from "../src/lib/wallapop-cdp"
import {
  CLICK_CONFIRM_ELIMINAR_EVAL,
  CLICK_SELLER_ELIMINAR_EVAL,
  FIND_ELIMINAR_DIALOG_EVAL,
  FIND_SELLER_ELIMINAR_EVAL,
  cacheBustItemUrl,
  publishedRowsContainItem,
} from "../src/lib/wallapop-eliminar"
import {
  isEliminarDryRun,
  listingForEliminar,
} from "../src/routes/product-wallapop-eliminar-prepare"

const ASALVO =
  "https://es.wallapop.com/item/asalvo-barandilla-150cm-2-en-1-erizo-1311721479"

async function withFixture<T>(
  name: string,
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  const html = fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8")
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent(html)
    return await fn(page)
  } finally {
    await browser.close()
  }
}

/** Record which walla-button text got clicked, without real handlers. */
const TRACK_CLICKS = `(() => {
  window.__clicked = [];
  document.querySelectorAll("walla-button").forEach((el) => {
    el.addEventListener("click", () => window.__clicked.push(el.getAttribute("text")));
  });
})()`

describe("eliminar DOM fixture (live 2026-10-11)", () => {
  it("finds Eliminar in the seller block and the confirm dialog", async () => {
    await withFixture("wallapop-item-eliminar-dialog.html", async (page) => {
      expect(await page.evaluate(FIND_SELLER_ELIMINAR_EVAL)).toBe("found")
      expect(await page.evaluate(FIND_ELIMINAR_DIALOG_EVAL)).toBe("found")
    })
  })

  it("clicks only Eliminar and Sí, eliminarlo — never Destacar / Vendido / keep", async () => {
    await withFixture("wallapop-item-eliminar-dialog.html", async (page) => {
      await page.evaluate(TRACK_CLICKS)
      expect(await page.evaluate(CLICK_SELLER_ELIMINAR_EVAL)).toBe("clicked")
      expect(await page.evaluate(CLICK_CONFIRM_ELIMINAR_EVAL)).toBe("clicked")
      const clicked = (await page.evaluate("window.__clicked")) as string[]
      expect(clicked).toEqual(["Eliminar", "Sí, eliminarlo"])
    })
  })

  it("reports a missing seller block on a page without it", async () => {
    await withFixture("wallapop-sold-modal.html", async (page) => {
      expect(await page.evaluate(FIND_SELLER_ELIMINAR_EVAL)).toBe(
        "missing_container",
      )
      expect(await page.evaluate(FIND_ELIMINAR_DIALOG_EVAL)).toBe("missing_dialog")
    })
  })
})

describe("cacheBustItemUrl", () => {
  it("keeps the /item/ path and adds a query so assign is not a same-href no-op", () => {
    const next = cacheBustItemUrl(ASALVO)
    expect(next.startsWith(ASALVO)).toBe(true)
    expect(next).not.toBe(ASALVO)
    expect(new URL(next).searchParams.get("_crm")).toMatch(/^\d+$/)
  })
})

describe("publishedRowsContainItem", () => {
  it("matches by /item/ path, ignoring host and query", () => {
    const rows = [
      { href: "https://es.wallapop.com/item/other-1234567890", reserved: false },
      { href: `${ASALVO}?from=catalog`, reserved: true },
    ]
    expect(publishedRowsContainItem(rows, ASALVO)).toBe(true)
    expect(publishedRowsContainItem(rows.slice(0, 1), ASALVO)).toBe(false)
    expect(publishedRowsContainItem([], ASALVO)).toBe(false)
  })
})

describe("listingForEliminar", () => {
  it("requires a live listing with an es /item/ URL on an unsold product", () => {
    expect(
      listingForEliminar({
        status: "SOLD",
        listings: [{ status: "ACTIVE", externalUrl: ASALVO }],
      }),
    ).toMatchObject({ code: "ALREADY_SOLD" })
    expect(
      listingForEliminar({
        status: "ACTIVE",
        listings: [{ status: "DEACTIVATED", externalUrl: null }],
      }),
    ).toMatchObject({ code: "LISTING_NOT_ACTIVE" })
    expect(
      listingForEliminar({
        status: "ACTIVE",
        listings: [
          { status: "ACTIVE", externalUrl: "https://es.wallapop.com/app/catalog/upload" },
        ],
      }),
    ).toMatchObject({ code: "NO_ITEM_URL" })
    expect(
      listingForEliminar({
        status: "ACTIVE",
        listings: [{ status: "RESERVED", externalUrl: ASALVO }],
      }),
    ).toEqual({ itemUrl: ASALVO })
  })
})

describe("isEliminarDryRun", () => {
  const prev = process.env.WALLAPOP_ELIMINAR_DRY_RUN
  afterEach(() => {
    if (prev === undefined) delete process.env.WALLAPOP_ELIMINAR_DRY_RUN
    else process.env.WALLAPOP_ELIMINAR_DRY_RUN = prev
  })

  it("is on unless WALLAPOP_ELIMINAR_DRY_RUN is exactly false", () => {
    delete process.env.WALLAPOP_ELIMINAR_DRY_RUN
    expect(isEliminarDryRun()).toBe(true)
    process.env.WALLAPOP_ELIMINAR_DRY_RUN = "FALSE"
    expect(isEliminarDryRun()).toBe(true)
    process.env.WALLAPOP_ELIMINAR_DRY_RUN = "false"
    expect(isEliminarDryRun()).toBe(false)
  })
})

describe("eliminar worker slot", () => {
  afterEach(() => {
    resetWallapopPublishAbortForTests()
  })

  it("runs next to sold but queues a second eliminar", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const run = runWithBrowserBusy("eliminar", async () => {
      await gate
    })
    expect(isBrowserEliminarBusy()).toBe(true)
    await runWithBrowserBusy("sold", async () => {
      expect(isBrowserSoldBusy()).toBe(true)
    })
    await runWithBrowserBusy("publish", async () => {})
    await expect(runWithBrowserBusy("eliminar", async () => {})).rejects.toSatisfy(
      isBrowserBusyError,
    )
    await expect(runWithBrowserBusy("login", async () => {})).rejects.toSatisfy(
      isBrowserBusyError,
    )
    release()
    await run
    expect(isBrowserEliminarBusy()).toBe(false)
  })
})

function product(
  status: InventoryProduct["status"],
  listing: Pick<NonNullable<InventoryProduct["listing"]>, "status" | "externalUrl"> | null,
): InventoryProduct {
  return {
    status,
    listing: listing
      ? {
          id: "l1",
          accountId: "a1",
          lastPostedAt: null,
          shippingEnabled: true,
          ...listing,
        }
      : null,
  } as InventoryProduct
}

describe("card buttons", () => {
  it("shows Eliminar en Wallapop only for a live /item/ on an unsold product", () => {
    expect(canEliminarOnWallapop(product("ACTIVE", { status: "ACTIVE", externalUrl: ASALVO }))).toBe(true)
    expect(canEliminarOnWallapop(product("ACTIVE", { status: "RESERVED", externalUrl: ASALVO }))).toBe(true)
    expect(canEliminarOnWallapop(product("ACTIVE", { status: "ACTIVE", externalUrl: null }))).toBe(false)
    expect(canEliminarOnWallapop(product("SOLD", { status: "ACTIVE", externalUrl: ASALVO }))).toBe(false)
    expect(canEliminarOnWallapop(product("ACTIVE", { status: "READY_TO_POST", externalUrl: null }))).toBe(false)
    expect(canEliminarOnWallapop(product("ACTIVE", null))).toBe(false)
  })

  it("shows Poner en cola only for DEACTIVATED on an unsold product", () => {
    expect(canRequeueListing(product("ACTIVE", { status: "DEACTIVATED", externalUrl: null }))).toBe(true)
    expect(canRequeueListing(product("INACTIVE", { status: "DEACTIVATED", externalUrl: null }))).toBe(true)
    expect(canRequeueListing(product("SOLD", { status: "DEACTIVATED", externalUrl: null }))).toBe(false)
    expect(canRequeueListing(product("ACTIVE", { status: "ACTIVE", externalUrl: ASALVO }))).toBe(false)
  })
})
