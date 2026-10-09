import type { Locator, Page } from "playwright";

import { log } from "../log";
import { crmDescriptionMatchesForm } from "../wallapop-description";
import {
  closeOpenDropdowns,
  clickFieldDropdownOption,
  listFieldDropdownOptions,
  openHiddenFieldDropdown,
} from "./dropdown";
import {
  PUBLISH_SELECTORS,
  WallapopPublishError,
  crmTitleMatchesForm,
  type PublishStep,
} from "./types";

export async function readPublishTitle(page: Page): Promise<string> {
  for (const sel of PUBLISH_SELECTORS.title) {
    const el = page.locator(sel).first();
    if (!(await el.count())) continue;
    const value = await el.inputValue().catch(() => "");
    if (typeof value === "string") return value;
  }
  return "";
}

export async function readPublishDescription(page: Page): Promise<string> {
  for (const sel of PUBLISH_SELECTORS.description) {
    const el = page.locator(sel).first();
    if (!(await el.count())) continue;
    const value = await el.inputValue().catch(() => "");
    if (typeof value === "string") return value;
  }
  return "";
}

const FILL_DESCRIPTION_NATIVE_JS = `((sel, v) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const proto =
        el instanceof HTMLTextAreaElement
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      el.focus();
      setter ? setter.call(el, v) : (el.value = v);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: v, inputType: "insertText" }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.blur();
      return (el.value || "").trim() === v.trim();
    })`;

async function fillDescriptionNative(
  page: Page,
  sel: string,
  value: string,
): Promise<boolean> {
  return (await page.evaluate(
    `${FILL_DESCRIPTION_NATIVE_JS}(${JSON.stringify(sel)}, ${JSON.stringify(value)})`,
  )) as boolean;
}

export async function fillPublishTitle(
  page: Page,
  value: string,
): Promise<boolean> {
  for (const sel of PUBLISH_SELECTORS.title) {
    const el = page.locator(sel).first();
    if (!(await el.count())) continue;
    if (!(await el.isVisible().catch(() => false))) continue;
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await el.click({ force: true }).catch(() => {});
    await el.fill(value, { force: true }).catch(() => {});
    if (crmTitleMatchesForm(await el.inputValue().catch(() => ""), value)) {
      return true;
    }
    if (await fillDescriptionNative(page, sel, value)) return true;
  }
  return false;
}

export async function ensureCrmTitleOnForm(
  page: Page,
  expected: string,
  step: PublishStep,
): Promise<void> {
  const want = expected.trim();
  if (!want) return;
  if (crmTitleMatchesForm(await readPublishTitle(page), want)) {
    return;
  }
  log("info", "wallapop_publish_title_rewrite", { step });
  const filled = await fillPublishTitle(page, want);
  if (filled && crmTitleMatchesForm(await readPublishTitle(page), want)) {
    return;
  }
  throw new WallapopPublishError(
    step,
    "El título en Wallapop no coincide con el del CRM (posible reescritura de IA).",
  );
}

export async function fillPublishDescription(
  page: Page,
  value: string,
): Promise<boolean> {
  for (const sel of PUBLISH_SELECTORS.description) {
    const el = page.locator(sel).first();
    if (!(await el.count())) continue;
    if (!(await el.isVisible().catch(() => false))) continue;
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await el.click({ force: true }).catch(() => {});
    await el.fill(value, { force: true }).catch(() => {});
    if (crmDescriptionMatchesForm(await el.inputValue().catch(() => ""), value)) {
      return true;
    }
    if (await fillDescriptionNative(page, sel, value)) return true;
  }
  return false;
}

export async function ensureCrmDescriptionOnForm(
  page: Page,
  expected: string,
  step: PublishStep,
): Promise<void> {
  const want = expected.trim();
  if (!want) return;
  if (crmDescriptionMatchesForm(await readPublishDescription(page), want)) {
    return;
  }
  log("info", "wallapop_publish_description_rewrite", { step });
  const filled = await fillPublishDescription(page, want);
  if (
    filled &&
    crmDescriptionMatchesForm(await readPublishDescription(page), want)
  ) {
    return;
  }
  throw new WallapopPublishError(
    step,
    "La descripción en Wallapop no coincide con la del CRM (posible reescritura de IA).",
  );
}

export async function readPriceAmount(page: Page): Promise<string> {
  return (await page
    .evaluate(
      `(() => document.querySelector("#price_amount, input[name=price_amount]")?.value?.trim() || "")()`,
    )
    .catch(() => "")) as string;
}

const FILL_PRICE_NATIVE_JS = `((v) => {
    const el = document.querySelector("#price_amount, input[name=price_amount]");
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    el.focus();
    setter ? setter.call(el, v) : (el.value = v);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: v, inputType: "insertText" }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
    return (el.value || "").trim() === v;
  })`;

async function fillPriceViaKeyboard(
  page: Page,
  el: Locator,
  value: string,
): Promise<boolean> {
  await el.click({ force: true }).catch(() => {});
  await page.keyboard.press("ControlOrMeta+A").catch(() => {});
  await page.keyboard.type(value, { delay: 30 });
  return (await readPriceAmount(page)) === value;
}

export async function fillPrice(page: Page, price: number): Promise<void> {
  const value = String(price);
  const el = page.locator("#price_amount, input[name=price_amount]").first();
  try {
    await el.waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    throw new WallapopPublishError(
      "form",
      "No se encontró el campo Precio (#price_amount).",
    );
  }
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await el.click({ force: true }).catch(() => {});
  await el.fill("");
  await el.fill(value);
  if ((await readPriceAmount(page)) === value) return;
  if (await fillPriceViaKeyboard(page, el, value)) return;
  const ok = (await page.evaluate(
    `${FILL_PRICE_NATIVE_JS}(${JSON.stringify(value)})`,
  )) as boolean;
  if (!ok || (await readPriceAmount(page)) !== value) {
    throw new WallapopPublishError(
      "form",
      `No se pudo rellenar el Precio (${value}).`,
    );
  }
}

async function readConditionValue(page: Page): Promise<string> {
  return (
    (await page.locator("#condition").first().inputValue().catch(() => "")) ||
    ""
  );
}

async function openEstadoDropdown(page: Page): Promise<boolean> {
  return openHiddenFieldDropdown(page, "condition");
}

async function clickEstadoOption(page: Page, label: string): Promise<boolean> {
  return clickFieldDropdownOption(page, "condition", label);
}

export async function ensureEstado(page: Page, label: string): Promise<void> {
  await page
    .locator("#condition")
    .first()
    .waitFor({ state: "attached", timeout: 12_000 })
    .catch(() => {});
  if ((await readConditionValue(page)).trim()) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    const opened = await openEstadoDropdown(page);
    const options = await listFieldDropdownOptions(page, "condition");
    log("info", "wallapop_publish_estado_try", {
      label,
      attempt,
      opened,
      options,
    });
    if (await clickEstadoOption(page, label)) {
      await page.waitForTimeout(400);
      const value = await readConditionValue(page);
      if (value.trim()) {
        log("info", "wallapop_publish_estado_selected", { label, value });
        return;
      }
    }
    await closeOpenDropdowns(page);
    await page.waitForTimeout(400);
  }
  throw new WallapopPublishError(
    "form",
    `No se pudo seleccionar el estado (${label}).`,
  );
}
