import type { Page } from "playwright"

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
