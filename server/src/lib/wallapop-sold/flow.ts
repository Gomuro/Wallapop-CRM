import type { Page } from "playwright"

import { log } from "../log"
import {
  clickSellerUnreserveButton,
  findSellerReserveButton,
  type SellerReserveState,
} from "../wallapop-reserve/click"
import {
  clickMarkAsSoldConfirm,
  findItemAlreadySold,
  findSellerSoldButton,
} from "./click"
import {
  clickSellerSoldAndWaitTab,
  gotoItemPage,
  gotoVendidosCatalog,
} from "./nav"
import {
  MarkWallapopSoldInput,
  MarkWallapopSoldResult,
  SoldStep,
  WallapopSoldError,
} from "./types"
import { vendidosFirstRowMatches, vendidosHrefMatches } from "./verify"

const SELLER_BLOCK_WAIT_MS = 20_000

type SellerSoldState = Awaited<ReturnType<typeof findSellerSoldButton>>

async function waitForSellerItem(page: Page): Promise<{
  sold: SellerSoldState
  reserve: SellerReserveState
  already: "badge" | "not"
}> {
  const deadline = Date.now() + SELLER_BLOCK_WAIT_MS
  let sold: SellerSoldState = "missing_container"
  let reserve: SellerReserveState = "missing_container"
  let already: "badge" | "not" = "not"
  while (Date.now() <= deadline) {
    already = await findItemAlreadySold(page)
    if (already !== "not") {
      return { sold, reserve, already }
    }
    sold = await findSellerSoldButton(page)
    reserve = await findSellerReserveButton(page)
    if (
      sold === "found" ||
      reserve === "already" ||
      reserve === "ready"
    ) {
      return { sold, reserve, already }
    }
    await page.waitForTimeout(300)
  }
  return { sold, reserve, already }
}

async function requireSellerSoldButton(page: Page): Promise<void> {
  const found = await findSellerSoldButton(page)
  if (found === "found") return
  const reserve = await findSellerReserveButton(page)
  log("warn", "wallapop_sold_seller_missing", {
    sold: found,
    reserve,
    url: page.url(),
  })
  throw new WallapopSoldError(
    "item",
    found === "missing_container"
      ? "El anuncio no mostró el bloque de vendedor. ¿Sesión o la página aún carga?"
      : 'No se encontró "Marcar como vendido" en el anuncio.',
  )
}

/** A sibling hold hides Marcar como vendido behind Anular reserva. */
async function releaseHoldSoItCanBeSold(page: Page): Promise<void> {
  if ((await findSellerSoldButton(page)) === "found") return
  if ((await findSellerReserveButton(page)) !== "already") return
  await clickSellerUnreserveButton(page)
  const deadline = Date.now() + 8_000
  while (Date.now() <= deadline) {
    if ((await findSellerSoldButton(page)) === "found") return
    if ((await findSellerReserveButton(page)) === "ready") return
    await page.waitForTimeout(250)
  }
  throw new WallapopSoldError(
    "item",
    'Tras Anular reserva el anuncio sigue sin "Marcar como vendido".',
  )
}

async function confirmAndVerifyVendidos(
  itemPage: Page,
  itemUrl: string,
  matchAnywhere: boolean,
): Promise<void> {
  const modalPage = await clickSellerSoldAndWaitTab(itemPage)
  await clickMarkAsSoldConfirm(modalPage)
  await modalPage.waitForTimeout(2_000)
  await gotoVendidosCatalog(modalPage)
  const matched = matchAnywhere
    ? await vendidosHrefMatches(modalPage, itemUrl)
    : await vendidosFirstRowMatches(modalPage, itemUrl)
  if (!matched) {
    throw new WallapopSoldError(
      "vendidos",
      matchAnywhere
        ? "El anuncio no apareció en Vendidos."
        : "El anuncio no apareció el primero en Vendidos.",
    )
  }
}

export async function runSoldAfterAttach(
  input: MarkWallapopSoldInput,
  page: Page,
  mark: (step: SoldStep) => void,
): Promise<MarkWallapopSoldResult> {
  mark("item")
  await gotoItemPage(page, input.itemUrl)
  const seen = await waitForSellerItem(page)
  if (seen.already !== "not") {
    log("info", "wallapop_sold_already_vendido", {
      how: seen.already,
      url: page.url(),
    })
    mark("sold")
    return { dryRun: input.dryRun, step: "sold", itemUrl: input.itemUrl }
  }
  if (!input.dryRun && seen.sold !== "found") {
    await releaseHoldSoItCanBeSold(page)
    const afterHold = await findItemAlreadySold(page)
    if (afterHold !== "not") {
      log("info", "wallapop_sold_already_vendido", {
        how: afterHold,
        url: page.url(),
      })
      mark("sold")
      return { dryRun: false, step: "sold", itemUrl: input.itemUrl }
    }
  }
  await requireSellerSoldButton(page)
  mark("before_confirm")
  if (input.dryRun) {
    return { dryRun: true, step: "before_confirm", itemUrl: input.itemUrl }
  }
  mark("confirm")
  await confirmAndVerifyVendidos(page, input.itemUrl, input.matchAnywhere === true)
  mark("sold")
  return { dryRun: false, step: "sold", itemUrl: input.itemUrl }
}
