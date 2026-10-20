import type { Page } from "playwright"

import {
  clickSellerUnreserveButton,
  findSellerReserveButton,
} from "../wallapop-reserve/click"
import { findSellerSoldButton, clickMarkAsSoldConfirm } from "./click"
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

async function requireSellerSoldButton(page: Page): Promise<void> {
  const found = await findSellerSoldButton(page)
  if (found !== "found") {
    throw new WallapopSoldError(
      "item",
      'No se encontró "Marcar como vendido" en el anuncio.',
    )
  }
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
  if (!input.dryRun && (await findSellerSoldButton(page)) !== "found") {
    await releaseHoldSoItCanBeSold(page)
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
