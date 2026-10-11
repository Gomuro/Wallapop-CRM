import type { Page } from "playwright"

import { log } from "../log"
import { WallapopEliminarError } from "./types"

/**
 * Live DOM 2026-10-11: seller block on /item/… holds Editar / Reservar /
 * Marcar como vendido / Eliminar. Destacar sits outside it. The block is
 * rendered twice (desktop + mobile), so only the first container is used.
 */
export const FIND_SELLER_ELIMINAR_EVAL = `(() => {
  const root = document.querySelector('[class*="ItemDetailSellerButtons"]');
  if (!root) return "missing_container";
  const buttons = [...root.querySelectorAll("walla-button")];
  for (const el of buttons) {
    const text = (
      el.getAttribute("text") ||
      el.shadowRoot?.querySelector?.("[part=button-text]")?.textContent ||
      ""
    ).trim();
    if (text === "Eliminar") return "found";
  }
  return "missing_button";
})()`

export const CLICK_SELLER_ELIMINAR_EVAL = `(() => {
  const root = document.querySelector('[class*="ItemDetailSellerButtons"]');
  if (!root) return "missing_container";
  const buttons = [...root.querySelectorAll("walla-button")];
  for (const el of buttons) {
    const text = (
      el.getAttribute("text") ||
      el.shadowRoot?.querySelector?.("[part=button-text]")?.textContent ||
      ""
    ).trim();
    if (text !== "Eliminar") continue;
    const inner = el.shadowRoot?.querySelector?.("button");
    const target = inner || el;
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }));
    target.click();
    return "clicked";
  }
  return "missing_button";
})()`

/** Same-tab `walla-dialog` «¿Quieres borrar el anuncio?». */
export const FIND_ELIMINAR_DIALOG_EVAL = `(() => {
  const dialog = document.querySelector("walla-dialog[is-open]");
  if (!dialog) return "missing_dialog";
  const buttons = [...dialog.querySelectorAll("walla-button")];
  const ok = buttons.some((el) => (el.getAttribute("text") || "").trim() === "Sí, eliminarlo");
  return ok ? "found" : "missing_button";
})()`

export const CLICK_CONFIRM_ELIMINAR_EVAL = `(() => {
  const dialog = document.querySelector("walla-dialog[is-open]");
  if (!dialog) return "missing_dialog";
  const buttons = [...dialog.querySelectorAll("walla-button")];
  for (const el of buttons) {
    const text = (
      el.getAttribute("text") ||
      el.shadowRoot?.querySelector?.("[part=button-text]")?.textContent ||
      ""
    ).trim();
    if (text !== "Sí, eliminarlo") continue;
    const inner = el.shadowRoot?.querySelector?.("button");
    const target = inner || el;
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }));
    target.click();
    return "clicked";
  }
  return "missing_button";
})()`

const DIALOG_WAIT_MS = 8_000
const POLL_MS = 250

export type SellerEliminarState = "found" | "missing_container" | "missing_button"

export async function findSellerEliminarButton(
  page: Page,
): Promise<SellerEliminarState> {
  const result = (await page.evaluate(FIND_SELLER_ELIMINAR_EVAL)) as string
  if (result === "found" || result === "missing_container") return result
  return "missing_button"
}

export async function clickSellerEliminarButton(page: Page): Promise<void> {
  const result = (await page.evaluate(CLICK_SELLER_ELIMINAR_EVAL)) as string
  log("info", "wallapop_eliminar_seller_click", { result })
  if (result !== "clicked") {
    throw new WallapopEliminarError(
      "item",
      'No se encontró "Eliminar" en el anuncio.',
    )
  }
}

export async function waitForEliminarDialog(page: Page): Promise<void> {
  const deadline = Date.now() + DIALOG_WAIT_MS
  let last = "missing_dialog"
  while (Date.now() < deadline) {
    last = (await page.evaluate(FIND_ELIMINAR_DIALOG_EVAL)) as string
    if (last === "found") return
    await page.waitForTimeout(POLL_MS)
  }
  log("warn", "wallapop_eliminar_dialog_missing", { result: last })
  throw new WallapopEliminarError(
    "confirm",
    'No apareció la confirmación "¿Quieres borrar el anuncio?".',
  )
}

export async function waitForEliminarDialogClosed(page: Page): Promise<boolean> {
  const deadline = Date.now() + DIALOG_WAIT_MS
  while (Date.now() < deadline) {
    const result = (await page.evaluate(FIND_ELIMINAR_DIALOG_EVAL)) as string
    if (result !== "found") return true
    await page.waitForTimeout(POLL_MS)
  }
  log("warn", "wallapop_eliminar_dialog_still_open")
  return false
}

export async function clickConfirmEliminar(page: Page): Promise<void> {
  const result = (await page.evaluate(CLICK_CONFIRM_ELIMINAR_EVAL)) as string
  log("info", "wallapop_eliminar_confirm_click", { result })
  if (result !== "clicked") {
    throw new WallapopEliminarError(
      "confirm",
      'No se encontró "Sí, eliminarlo" en la confirmación.',
    )
  }
}
