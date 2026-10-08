import type { Page } from "playwright"

import { log } from "../log"
import { WallapopSoldError } from "./types"

/** Live DOM 2026-10-08: seller block on /item/…, not Destacar. */
export const FIND_SELLER_SOLD_EVAL = `(() => {
  const root = document.querySelector('[class*="ItemDetailSellerButtons"]');
  if (!root) return "missing_container";
  const buttons = [...root.querySelectorAll("walla-button")];
  for (const el of buttons) {
    const text = (
      el.getAttribute("text") ||
      el.shadowRoot?.querySelector?.("[part=button-text]")?.textContent ||
      ""
    ).trim();
    if (text !== "Marcar como vendido") continue;
    return "found";
  }
  return "missing_button";
})()`

export const CLICK_SELLER_SOLD_EVAL = `(() => {
  const root = document.querySelector('[class*="ItemDetailSellerButtons"]');
  if (!root) return "missing_container";
  const buttons = [...root.querySelectorAll("walla-button")];
  for (const el of buttons) {
    const text = (
      el.getAttribute("text") ||
      el.shadowRoot?.querySelector?.("[part=button-text]")?.textContent ||
      ""
    ).trim();
    if (text !== "Marcar como vendido") continue;
    const target = el.shadowRoot?.querySelector?.("button") || el;
    target.click();
    return "clicked";
  }
  return "missing_button";
})()`

export const CLICK_MARK_AS_SOLD_EVAL = `(() => {
  const host = document.querySelector("walla-button#markAsSoldButton");
  if (!host) return "missing_button";
  const target = host.shadowRoot?.querySelector?.("button") || host;
  target.click();
  return "clicked";
})()`

export async function findSellerSoldButton(
  page: Page,
): Promise<"found" | "missing_container" | "missing_button"> {
  const result = (await page.evaluate(FIND_SELLER_SOLD_EVAL)) as string
  if (
    result === "found" ||
    result === "missing_container" ||
    result === "missing_button"
  ) {
    return result
  }
  return "missing_button"
}

export async function clickSellerSoldButton(page: Page): Promise<void> {
  const result = (await page.evaluate(CLICK_SELLER_SOLD_EVAL)) as string
  log("info", "wallapop_sold_seller_click", { result })
  if (result !== "clicked") {
    throw new WallapopSoldError(
      "item",
      'No se encontró "Marcar como vendido" en el anuncio.',
    )
  }
}

export async function clickMarkAsSoldConfirm(page: Page): Promise<void> {
  const result = (await page.evaluate(CLICK_MARK_AS_SOLD_EVAL)) as string
  log("info", "wallapop_sold_confirm_click", { result })
  if (result !== "clicked") {
    throw new WallapopSoldError(
      "confirm",
      "No se encontró el confirmador #markAsSoldButton.",
    )
  }
}
