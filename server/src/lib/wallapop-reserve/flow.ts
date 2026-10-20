import type { Page } from "playwright"

import { dismissWallapopConsent, navigateViaAssign } from "../wallapop-cdp"
import {
  clickSellerReserveButton,
  clickSellerUnreserveButton,
  findSellerReserveButton,
} from "./click"
import {
  WallapopReserveError,
  type MarkWallapopReservedResult,
  type MarkWallapopUnreservedResult,
} from "./types"

const RESERVE_WAIT_MS = 8_000
const POLL_MS = 250

async function waitUntilReserved(page: Page): Promise<void> {
  const deadline = Date.now() + RESERVE_WAIT_MS
  while (Date.now() <= deadline) {
    if ((await findSellerReserveButton(page)) === "already") return
    await page.waitForTimeout(POLL_MS)
  }
  throw new WallapopReserveError(
    "reserved",
    'Tras Reservar producto el anuncio no mostró "Anular reserva".',
  )
}

export async function runReserveAfterAttach(
  itemUrl: string,
  page: Page,
): Promise<MarkWallapopReservedResult> {
  await navigateViaAssign(page, itemUrl)
  await dismissWallapopConsent(page)
  const state = await findSellerReserveButton(page)
  if (state === "already") {
    return { itemUrl, step: "reserved", already: true }
  }
  if (state !== "ready") {
    throw new WallapopReserveError(
      "item",
      'No se encontró "Reservar producto" en el anuncio.',
    )
  }
  await page.bringToFront().catch(() => {})
  await clickSellerReserveButton(page)
  await waitUntilReserved(page)
  return { itemUrl, step: "reserved", already: false }
}

async function waitUntilUnreserved(page: Page): Promise<void> {
  const deadline = Date.now() + RESERVE_WAIT_MS
  while (Date.now() <= deadline) {
    if ((await findSellerReserveButton(page)) === "ready") return
    await page.waitForTimeout(POLL_MS)
  }
  throw new WallapopReserveError(
    "reserved",
    'Tras Anular reserva el anuncio no volvió a "Reservar producto".',
  )
}

export async function runUnreserveAfterAttach(
  itemUrl: string,
  page: Page,
): Promise<MarkWallapopUnreservedResult> {
  await navigateViaAssign(page, itemUrl)
  await dismissWallapopConsent(page)
  const state = await findSellerReserveButton(page)
  if (state === "ready") {
    return { itemUrl, step: "active", already: true }
  }
  if (state !== "already") {
    throw new WallapopReserveError(
      "item",
      'No se encontró "Anular reserva" en el anuncio.',
    )
  }
  await page.bringToFront().catch(() => {})
  await clickSellerUnreserveButton(page)
  await waitUntilUnreserved(page)
  return { itemUrl, step: "active", already: false }
}
