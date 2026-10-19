import { describe, expect, it } from "vitest"

import { siblingSoldTargets } from "../src/lib/sibling-eliminar"

const VEVOR = "https://es.wallapop.com/item/vevor-cambiador-1313941336"
const OTHER = "https://es.wallapop.com/item/otro-anuncio-1310000001"

describe("siblingSoldTargets", () => {
  it("keeps the selling account and marks the other live ads sold", () => {
    expect(
      siblingSoldTargets(
        [
          {
            accountId: "default",
            status: "DEACTIVATED",
            externalUrl: VEVOR,
          },
          {
            accountId: "second",
            status: "ACTIVE",
            externalUrl: OTHER,
          },
          {
            accountId: "third",
            status: "RESERVED",
            externalUrl: VEVOR,
          },
          {
            accountId: "empty",
            status: "ACTIVE",
            externalUrl: null,
          },
          {
            accountId: "queue",
            status: "READY_TO_POST",
            externalUrl: OTHER,
          },
        ],
        "default",
      ),
    ).toEqual([
      { accountId: "second", itemUrl: OTHER },
      { accountId: "third", itemUrl: VEVOR },
    ])
  })

  it("does not mark the account that recorded the sale", () => {
    expect(
      siblingSoldTargets(
        [
          {
            accountId: "default",
            status: "ACTIVE",
            externalUrl: VEVOR,
          },
        ],
        "default",
      ),
    ).toEqual([])
  })
})
