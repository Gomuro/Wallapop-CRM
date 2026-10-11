import type { Page } from "playwright"

import { dismissWallapopConsent, navigateViaAssign } from "../wallapop-cdp"
import {
  clickConfirmEliminar,
  clickSellerEliminarButton,
  findSellerEliminarButton,
  waitForEliminarDialog,
  waitForEliminarDialogClosed,
} from "./click"
import {
  type EliminarStep,
  type EliminarWallapopInput,
  type EliminarWallapopResult,
  WallapopEliminarError,
} from "./types"
import { verifyItemEliminated } from "./verify"

const CONFIRM_SETTLE_MS = 2_500

async function gotoItemPage(page: Page, itemUrl: string): Promise<void> {
  await navigateViaAssign(page, itemUrl)
  await dismissWallapopConsent(page)
}

async function requireSellerEliminarButton(page: Page): Promise<void> {
  if ((await findSellerEliminarButton(page)) !== "found") {
    throw new WallapopEliminarError(
      "item",
      'No se encontró "Eliminar" en el anuncio.',
    )
  }
}

export async function runEliminarAfterAttach(
  input: EliminarWallapopInput,
  page: Page,
  mark: (step: EliminarStep) => void,
): Promise<EliminarWallapopResult> {
  mark("item")
  await gotoItemPage(page, input.itemUrl)
  await requireSellerEliminarButton(page)
  mark("before_confirm")
  if (input.dryRun) {
    return { dryRun: true, step: "before_confirm", itemUrl: input.itemUrl }
  }
  mark("confirm")
  await clickSellerEliminarButton(page)
  await waitForEliminarDialog(page)
  await clickConfirmEliminar(page)
  await waitForEliminarDialogClosed(page)
  await page.waitForTimeout(CONFIRM_SETTLE_MS)
  mark("verify")
  await verifyItemEliminated(page, input.itemUrl)
  mark("eliminated")
  return { dryRun: false, step: "eliminated", itemUrl: input.itemUrl }
}
