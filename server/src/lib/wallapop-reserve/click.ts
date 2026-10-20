import type { Page } from "playwright"

import { log } from "../log"
import { WallapopReserveError } from "./types"

/**
 * Live DOM 2026-10-19: seller block on /item/ holds Editar / Reservar producto /
 * Marcar como vendido / Eliminar. Destacar sits outside it. One click reserves;
 * the same button then reads Anular reserva. No confirm dialog.
 */
export const FIND_SELLER_RESERVE_EVAL = `(() => {
  const root = document.querySelector('[class*="ItemDetailSellerButtons"]');
  if (!root) return "missing_container";
  const texts = [...root.querySelectorAll("walla-button")].map((el) =>
    (
      el.getAttribute("text") ||
      el.shadowRoot?.querySelector?.("[part=button-text]")?.textContent ||
      ""
    ).trim(),
  );
  if (texts.includes("Anular reserva")) return "already";
  if (texts.includes("Reservar producto")) return "ready";
  return "missing_button";
})()`

export const CLICK_SELLER_RESERVE_EVAL = `(() => {
  const root = document.querySelector('[class*="ItemDetailSellerButtons"]');
  if (!root) return "missing_container";
  for (const el of root.querySelectorAll("walla-button")) {
    const text = (
      el.getAttribute("text") ||
      el.shadowRoot?.querySelector?.("[part=button-text]")?.textContent ||
      ""
    ).trim();
    if (text !== "Reservar producto") continue;
    const inner = el.shadowRoot?.querySelector?.("button");
    const target = inner || el;
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
    );
    target.click();
    return "clicked";
  }
  return "missing_button";
})()`

export type SellerReserveState = "already" | "ready" | "missing_container" | "missing_button"

export async function findSellerReserveButton(page: Page): Promise<SellerReserveState> {
  const result = (await page.evaluate(FIND_SELLER_RESERVE_EVAL)) as string
  if (
    result === "already" ||
    result === "ready" ||
    result === "missing_container" ||
    result === "missing_button"
  ) {
    return result
  }
  return "missing_button"
}

export const CLICK_SELLER_UNRESERVE_EVAL = `(() => {
  const root = document.querySelector('[class*="ItemDetailSellerButtons"]');
  if (!root) return "missing_container";
  for (const el of root.querySelectorAll("walla-button")) {
    const text = (
      el.getAttribute("text") ||
      el.shadowRoot?.querySelector?.("[part=button-text]")?.textContent ||
      ""
    ).trim();
    if (text !== "Anular reserva") continue;
    const inner = el.shadowRoot?.querySelector?.("button");
    const target = inner || el;
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
    );
    target.click();
    return "clicked";
  }
  return "missing_button";
})()`

export async function clickSellerReserveButton(page: Page): Promise<void> {
  const result = (await page.evaluate(CLICK_SELLER_RESERVE_EVAL)) as string
  log("info", "wallapop_reserve_seller_click", { result })
  if (result !== "clicked") {
    throw new WallapopReserveError(
      "item",
      'No se encontró "Reservar producto" en el anuncio.',
    )
  }
}

export async function clickSellerUnreserveButton(page: Page): Promise<void> {
  const result = (await page.evaluate(CLICK_SELLER_UNRESERVE_EVAL)) as string
  log("info", "wallapop_unreserve_seller_click", { result })
  if (result !== "clicked") {
    throw new WallapopReserveError(
      "item",
      'No se encontró "Anular reserva" en el anuncio.',
    )
  }
}
