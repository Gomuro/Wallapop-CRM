import { chromium } from "playwright"
import { describe, expect, it } from "vitest"

import {
  siblingReserveTargets,
  siblingUnreserveTargets,
} from "../src/lib/sibling-reserve"
import {
  CLICK_SELLER_RESERVE_EVAL,
  CLICK_SELLER_UNRESERVE_EVAL,
  FIND_SELLER_RESERVE_EVAL,
} from "../src/lib/wallapop-reserve"

const FIRST = "https://es.wallapop.com/item/arcon-keter-1314940601"
const SECOND = "https://es.wallapop.com/item/arcon-keter-otra-1314940602"

describe("siblingReserveTargets", () => {
  it("reserves the other account that is still for sale", () => {
    expect(
      siblingReserveTargets(
        [
          { accountId: "second", status: "RESERVED", externalUrl: SECOND },
          { accountId: "default", status: "ACTIVE", externalUrl: FIRST },
          { accountId: "queue", status: "READY_TO_POST", externalUrl: null },
        ],
        "second",
      ),
    ).toEqual([{ accountId: "default", itemUrl: FIRST }])
  })

  it("releases the other account after the purchase is gone", () => {
    expect(
      siblingUnreserveTargets(
        [
          { accountId: "second", status: "DEACTIVATED", externalUrl: null },
          { accountId: "default", status: "RESERVED", externalUrl: FIRST },
          { accountId: "queue", status: "READY_TO_POST", externalUrl: null },
        ],
        "second",
      ),
    ).toEqual([{ accountId: "default", itemUrl: FIRST }])
  })

  it("does nothing when no account is reserved", () => {
    expect(
      siblingReserveTargets(
        [{ accountId: "default", status: "ACTIVE", externalUrl: FIRST }],
        null,
      ),
    ).toEqual([])
  })
})

describe("Reservar producto", () => {
  it("clicks Reservar producto and then sees Anular reserva", async () => {
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setContent(`<!DOCTYPE html><body>
        <div class="ItemDetailSellerButtons">
          <walla-button id="reserve" text="Reservar producto"></walla-button>
        </div>
      </body>`)
      await page.locator("#reserve").evaluate((el) => {
        el.addEventListener("click", () => {
          el.setAttribute("text", "Anular reserva")
        })
      })
      expect(await page.evaluate(FIND_SELLER_RESERVE_EVAL)).toBe("ready")
      expect(await page.evaluate(CLICK_SELLER_RESERVE_EVAL)).toBe("clicked")
      expect(await page.evaluate(FIND_SELLER_RESERVE_EVAL)).toBe("already")
    } finally {
      await browser.close()
    }
  })

  it("clicks Anular reserva and then sees Reservar producto", async () => {
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setContent(`<!DOCTYPE html><body>
        <div class="ItemDetailSellerButtons">
          <walla-button id="reserve" text="Anular reserva"></walla-button>
        </div>
      </body>`)
      await page.locator("#reserve").evaluate((el) => {
        el.addEventListener("click", () => {
          el.setAttribute("text", "Reservar producto")
        })
      })
      expect(await page.evaluate(FIND_SELLER_RESERVE_EVAL)).toBe("already")
      expect(await page.evaluate(CLICK_SELLER_UNRESERVE_EVAL)).toBe("clicked")
      expect(await page.evaluate(FIND_SELLER_RESERVE_EVAL)).toBe("ready")
    } finally {
      await browser.close()
    }
  })
})
