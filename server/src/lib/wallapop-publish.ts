/**
 * Wallapop consumer-goods publish via Chrome CDP.
 * Imports only wallapop-cdp primitives (not login SELECTORS).
 * Research: Desk/.../autopost-research/PUBLISH-FLOW-RESEARCH.md
 */
import type { Page } from "playwright";

import {
  closeWallapopUploadTab,
  dismissWallapopConsent,
  ensureWallapopPage,
  firstVisible,
  navigateViaAssign,
  quitWallapopChrome,
  runWithBrowserBusy,
} from "./wallapop-cdp";
import { log } from "./log";
import { crmDescriptionMatchesForm } from "./wallapop-description";
import {
  wallapopStandardWeightBandAriaName,
  wallapopStandardWeightBandFromCrm,
} from "./wallapop-weight-band";

const UPLOAD_URL = "https://es.wallapop.com/app/catalog/upload";
const SUMMARY_MAX = 50;

const FINAL_RE =
  /^(Publicar|Publicar anuncio|Crear producto|Subir anuncio|Subir producto|Опублікувати|Пост|Publish|Post)$/i;

const ESTADO_BY_CONDITION: Record<string, string> = {
  NEW: "Nuevo",
  AS_GOOD_AS_NEW: "Como nuevo",
  GOOD: "En buen estado",
  FAIR: "En condiciones aceptables",
  HAS_GIVEN_IT_ALL: "Lo ha dado todo",
};

/**
 * Category picker (UploadCategoriesSelector): `walla-dropdown` → floating `[role=listbox]`
 * with `walla-dropdown-item[role=option][aria-label="…"]` (Categorías sugeridas + Todas).
 */
const PUBLISH_CATEGORY = {
  sectionHeading: /Selecciona una categoría/i,
  triggerText: "Categoría y subcategoría",
  comboboxName: /categoría/i,
  dropdownTag: "walla-dropdown",
  listboxRole: "listbox",
  optionTag: "walla-dropdown-item",
} as const;

const PUBLISH_SELECTORS = {
  summary: ["#summary", 'input[name="summary"]'],
  price: [
    'input[name="price_amount"]',
    "#price_amount",
    'input[name="price"]',
    "#price",
    'input[placeholder*="Precio" i]',
    'input[aria-label*="Precio" i]',
  ],
  title: [
    'input[name="title"]',
    "#title",
    'input[aria-label*="Título" i]',
    'input[placeholder*="Título" i]',
  ],
  description: [
    'textarea[name="description"]',
    "#description",
    'textarea[aria-label*="Descripción" i]',
  ],
} as const;

export type PublishStep =
  | "attach"
  | "upload_entry"
  | "consumer_goods"
  | "summary"
  | "photos"
  | "form"
  | "before_publicar"
  | "published";

export type ShippingPackageType = "STANDARD" | "BULKY";

export type PublishWallapopInput = {
  title: string;
  description: string;
  price: number;
  condition: string;
  brand?: string | null;
  imagePaths: string[];
  /** Spanish breadcrumb root → leaf from CRM `Category.path`. */
  categoryLabels: string[];
  dryRun: boolean;
  shippingEnabled?: boolean;
  packageType?: ShippingPackageType;
  weightKg?: number | null;
  widthCm?: number | null;
  lengthCm?: number | null;
  heightCm?: number | null;
};

export type PublishWallapopResult = {
  ok: true;
  dryRun: boolean;
  step: PublishStep;
  externalUrl?: string | null;
};

export class WallapopPublishError extends Error {
  step: PublishStep;
  constructor(step: PublishStep, message: string) {
    super(message);
    this.name = "WallapopPublishError";
    this.step = step;
  }
}

const PUBLICAR_SETTLE_MS = 5_000;

export type PageUrlReader = {
  url: () => string;
  waitForTimeout: (ms: number) => Promise<void>;
};

export function listingUrlFromPageUrl(url: string): string | null {
  return url.includes("wallapop.com") ? url : null;
}

/**
 * Playwright tore down the tab/context after (or during) in-page click.
 * Treat as posted: the DOM click may already have run; reverting would duplicate.
 */
export function isPublicarContextDestroyedError(error: unknown): boolean {
  const message = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase();
  return (
    message.includes("target closed") ||
    message.includes("execution context was destroyed") ||
    message.includes("page closed") ||
    (message.includes("protocol error") && message.includes("closed"))
  );
}

/**
 * After a successful Publicar click: wait/url are best-effort.
 * Tab teardown (Target closed) still counts as posted — never throws.
 */
export async function readUrlAfterPublicarClick(
  page: PageUrlReader,
  settleMs = PUBLICAR_SETTLE_MS,
): Promise<string | null> {
  try {
    await page.waitForTimeout(settleMs);
    return listingUrlFromPageUrl(page.url());
  } catch (error) {
    log("warn", "wallapop_publish_url_after_publicar_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function truncateSummary(title: string): string {
  const trimmed = title.trim().replace(/\s+/g, " ");
  if (trimmed.length <= SUMMARY_MAX) return trimmed;
  return trimmed.slice(0, SUMMARY_MAX);
}

function estadoLabel(condition: string): string {
  return ESTADO_BY_CONDITION[condition] ?? "Como nuevo";
}

function logPublishStep(
  step: PublishStep,
  page: Page,
  extra?: Record<string, unknown>,
): void {
  log("info", "wallapop_publish_step", {
    step,
    url: page.url(),
    ...extra,
  });
}

async function categorySectionVisible(page: Page): Promise<boolean> {
  const body = (await page.evaluate(
    `document.body ? document.body.innerText : ""`,
  )) as string;
  return PUBLISH_CATEGORY.sectionHeading.test(body);
}

async function categoryPickerStillEmpty(page: Page): Promise<boolean> {
  return Boolean(
    await page.evaluate(`(() => {
      const body = document.body ? document.body.innerText : "";
      if (!/Selecciona una categoría/i.test(body)) return false;
      const trigger = ${JSON.stringify(PUBLISH_CATEGORY.triggerText)};
      const idx = body.indexOf(trigger);
      if (idx === -1) return false;
      const after = body.slice(idx, idx + 200);
      if (after.trim() === trigger) return true;
      if (after.startsWith(trigger + "\\n") && after.length < trigger.length + 40) return true;
      return false;
    })()`),
  );
}

async function categoryDropdownOpen(page: Page): Promise<boolean> {
  return Boolean(
    await page.evaluate(`(() => {
      const listbox = document.querySelector('[role="listbox"]');
      if (!listbox) return false;
      const r = listbox.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      return !!listbox.querySelector("walla-dropdown-item[role=option]");
    })()`),
  );
}

async function scrollCategorySectionIntoView(page: Page): Promise<void> {
  await page
    .getByText(PUBLISH_CATEGORY.sectionHeading)
    .first()
    .scrollIntoViewIfNeeded()
    .catch(() => {});
  await page.evaluate(`(() => {
    const h1 = [...document.querySelectorAll("h1")].find((h) =>
      /Selecciona una categoría/i.test(h.innerText || ""),
    );
    h1?.scrollIntoView({ block: "center" });
  })()`);
  await page.waitForTimeout(500);
}

async function openCategoryPicker(page: Page): Promise<void> {
  await scrollCategorySectionIntoView(page);
  if (await categoryDropdownOpen(page)) return;

  const dropdown = page.locator(PUBLISH_CATEGORY.dropdownTag).filter({
    hasText: PUBLISH_CATEGORY.triggerText,
  });
  if (
    await dropdown
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    await dropdown.first().click({ force: true });
    await page.waitForTimeout(900);
    if (await categoryDropdownOpen(page)) return;
    const roleBtn = dropdown.first().locator('[role="button"]').first();
    if (await roleBtn.isVisible().catch(() => false)) {
      await roleBtn.click({ force: true });
      await page.waitForTimeout(900);
      if (await categoryDropdownOpen(page)) return;
    }
  }

  const byRole = page.getByRole("button", {
    name: PUBLISH_CATEGORY.triggerText,
    exact: true,
  });
  if (
    await byRole
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    await byRole.first().click({ force: true });
    await page.waitForTimeout(900);
    if (await categoryDropdownOpen(page)) return;
  }

  await page.evaluate(`(() => {
    const dd = document.querySelector("walla-dropdown");
    if (dd) {
      const btn = dd.querySelector('[role="button"]') || dd;
      btn?.click?.();
      return true;
    }
    return false;
  })()`);
  await page.waitForTimeout(900);
}

async function clickWallaDropdownOption(
  page: Page,
  label: string,
): Promise<boolean> {
  const item = page
    .locator(
      `${PUBLISH_CATEGORY.optionTag}[role=option][aria-label="${label}"]`,
    )
    .first();
  if (await item.isVisible().catch(() => false)) {
    await item.click({ force: true });
    await page.waitForTimeout(1_000);
    return true;
  }

  const byRole = page.getByRole("option", { name: label, exact: true });
  if (
    await byRole
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    await byRole.first().click({ force: true });
    await page.waitForTimeout(1_000);
    return true;
  }

  const clicked = await page.evaluate(`((label) => {
    const listbox = document.querySelector('[role="listbox"]');
    if (!listbox) return false;
    const items = listbox.querySelectorAll(
      'walla-dropdown-item[role="option"]',
    );
    for (const el of items) {
      const aria = el.getAttribute("aria-label") || "";
      if (aria === label) {
        el.click();
        return true;
      }
    }
    return false;
  })(${JSON.stringify(label)})`);
  if (clicked) {
    await page.waitForTimeout(1_000);
    return true;
  }
  return false;
}

async function clickCategoryOption(
  page: Page,
  label: string,
): Promise<boolean> {
  if (await clickWallaDropdownOption(page, label)) return true;
  return false;
}

async function ensureCategorySelected(
  page: Page,
  labels: string[],
): Promise<void> {
  if (!labels.length) {
    throw new WallapopPublishError(
      "form",
      "Faltan etiquetas de categoría para Wallapop.",
    );
  }
  const leaf = labels[labels.length - 1]!;
  const body = (await page.evaluate(
    `document.body ? document.body.innerText : ""`,
  )) as string;
  if (body.includes(leaf) && !(await categoryPickerStillEmpty(page))) {
    logPublishStep("form", page, { category: "already_set", leaf });
    return;
  }

  logPublishStep("form", page, { category: "select_start", labels });
  await openCategoryPicker(page);
  logPublishStep("form", page, {
    category: "picker_open",
    open: await categoryDropdownOpen(page),
  });

  if (await clickCategoryOption(page, leaf)) {
    await page.waitForTimeout(500);
    if (!(await categoryPickerStillEmpty(page))) {
      logPublishStep("form", page, {
        category: "select_done",
        leaf,
        via: "leaf_suggested",
      });
      return;
    }
  }

  for (const label of labels) {
    if (!(await categoryDropdownOpen(page))) {
      await openCategoryPicker(page);
    }
    const clicked = await clickCategoryOption(page, label);
    if (!clicked) {
      log("warn", "wallapop_publish_category_click_miss", { label });
    } else if (label === leaf && !(await categoryPickerStillEmpty(page))) {
      logPublishStep("form", page, {
        category: "select_done",
        leaf,
        via: "breadcrumb",
      });
      return;
    }
    await page.waitForTimeout(400);
  }

  if (await categoryPickerStillEmpty(page)) {
    const hint =
      labels.length === 1 && /coches|motos|inmobiliaria/i.test(labels[0] ?? "")
        ? " Elige una categoría de consumer goods en el CRM (p. ej. Electrodomésticos)."
        : "";
    throw new WallapopPublishError(
      "form",
      `No se pudo seleccionar la categoría (${leaf}). Abre el desplegable en Chrome y comprueba las etiquetas.${hint}`,
    );
  }
  logPublishStep("form", page, { category: "select_done", leaf });
}

async function visibleButtonLabels(page: Page): Promise<string[]> {
  return (await page.evaluate(`(() => {
    const visible = (el) => {
      const s = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0;
    };
    const labelOf = (el) => {
      const shadowBtn = el.shadowRoot?.querySelector?.("button");
      return (
        el.innerText ||
        el.getAttribute("aria-label") ||
        el.getAttribute("text") ||
        shadowBtn?.innerText ||
        shadowBtn?.getAttribute("aria-label") ||
        ""
      )
        .trim()
        .replace(/\\s+/g, " ")
        .slice(0, 60);
    };
    return [...document.querySelectorAll("button, [role=button], walla-button")]
      .filter(visible)
      .map(labelOf)
      .filter(Boolean)
      .slice(0, 12);
  })()`)) as string[];
}

async function dismissSearchOverlay(page: Page): Promise<void> {
  await page.evaluate(`(() => {
    const s = document.querySelector('input[name="search"]');
    if (s) { s.value = ""; s.dispatchEvent(new Event("input", { bubbles: true })); s.blur(); }
  })()`);
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
}

async function clickExactButtonText(
  page: Page,
  text: string,
): Promise<boolean> {
  const clicked = await page.evaluate(`(() => {
    const label = ${JSON.stringify(text)};
    const buttons = [...document.querySelectorAll("button")];
    const match = buttons.find((b) => (b.innerText || "").trim() === label);
    if (!match) return false;
    match.click();
    return true;
  })()`);
  if (clicked) await page.waitForTimeout(2_500);
  return Boolean(clicked);
}

async function clickEnabledContinuar(
  page: Page,
): Promise<"OK" | "FINAL" | "NONE"> {
  const btns = page.getByRole("button", { name: /^(Continuar|Siguiente)$/i });
  const n = await btns.count();
  for (let i = 0; i < n; i++) {
    const b = btns.nth(i);
    const t = (await b.innerText().catch(() => "")).trim();
    if (FINAL_RE.test(t)) return "FINAL";
    if (await b.isDisabled().catch(() => true)) continue;
    await b.scrollIntoViewIfNeeded().catch(() => {});
    await b.click({ force: true });
    await page.waitForTimeout(4_000);
    return "OK";
  }
  return "NONE";
}

async function clickMainText(page: Page, text: string): Promise<boolean> {
  const loc = page.getByText(text, { exact: true });
  const n = await loc.count();
  for (let i = 0; i < n; i++) {
    const box = await loc.nth(i).boundingBox();
    if (!box || box.x < 280 || box.y < 80) continue;
    await loc.nth(i).click({ force: true });
    await page.waitForTimeout(800);
    return true;
  }
  return false;
}

async function fillIfEmpty(
  page: Page,
  selectors: readonly string[],
  value: string,
): Promise<boolean> {
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (!(await el.count())) continue;
    if (!(await el.isVisible().catch(() => false))) continue;
    const cur = await el.inputValue().catch(() => "");
    if (cur?.trim()) return false;
    await el.fill(value, { force: true }).catch(() => {});
    return true;
  }
  return false;
}

async function readPublishDescription(page: Page): Promise<string> {
  for (const sel of PUBLISH_SELECTORS.description) {
    const el = page.locator(sel).first();
    if (!(await el.count())) continue;
    const value = await el.inputValue().catch(() => "");
    if (typeof value === "string") return value;
  }
  return "";
}

async function fillPublishDescription(
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
    if (
      crmDescriptionMatchesForm(await el.inputValue().catch(() => ""), value)
    ) {
      return true;
    }
    const ok = (await page.evaluate(`((sel, v) => {
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
    })(${JSON.stringify(sel)}, ${JSON.stringify(value)})`)) as boolean;
    if (ok) return true;
  }
  return false;
}

async function ensureCrmDescriptionOnForm(
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

async function readPriceAmount(page: Page): Promise<string> {
  return (await page
    .evaluate(
      `(() => document.querySelector("#price_amount, input[name=price_amount]")?.value?.trim() || "")()`,
    )
    .catch(() => "")) as string;
}

async function fillPrice(page: Page, price: number): Promise<void> {
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

  // walla-text-input / Angular: Playwright fill sometimes does not stick; type + native setter.
  await el.click({ force: true }).catch(() => {});
  await page.keyboard.press("ControlOrMeta+A").catch(() => {});
  await page.keyboard.type(value, { delay: 30 });
  if ((await readPriceAmount(page)) === value) return;

  const ok = (await page.evaluate(`((v) => {
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
  })(${JSON.stringify(value)})`)) as boolean;

  if (!ok || (await readPriceAmount(page)) !== value) {
    throw new WallapopPublishError(
      "form",
      `No se pudo rellenar el Precio (${value}).`,
    );
  }
}

async function openEstadoDropdown(page: Page): Promise<void> {
  const btn = page.getByRole("button", { name: /^Estado/i });
  if (
    await btn
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    await btn.first().click({ force: true });
    await page.waitForTimeout(900);
    return;
  }
  const dd = page.locator('walla-dropdown[aria-label*="Estado" i]').first();
  if (await dd.isVisible().catch(() => false)) {
    await dd.click({ force: true });
    await page.waitForTimeout(900);
  }
}

async function ensureEstado(page: Page, label: string): Promise<void> {
  const hidden = page.locator("#condition").first();
  const cur = await hidden.inputValue().catch(() => "");
  if (cur?.trim()) return;

  for (let attempt = 0; attempt < 2; attempt++) {
    await openEstadoDropdown(page);
    if (await clickWallaDropdownOption(page, label)) {
      const after = await hidden.inputValue().catch(() => "");
      if (after?.trim()) return;
    }
    await page.waitForTimeout(400);
  }
  throw new WallapopPublishError(
    "form",
    `No se pudo seleccionar el estado (${label}).`,
  );
}

async function fillWallaTextInput(
  page: Page,
  selector: string,
  value: string,
): Promise<boolean> {
  const el = page.locator(selector).first();
  try {
    await el.waitFor({ state: "visible", timeout: 8_000 });
  } catch {
    return false;
  }
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await el.click({ force: true }).catch(() => {});
  await el.fill("");
  await el.fill(value);
  const cur = await el.inputValue().catch(() => "");
  if (cur?.trim() === value) return true;

  return Boolean(
    await page.evaluate(`((sel, v) => {
      const el = document.querySelector(sel);
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
    })(${JSON.stringify(selector)}, ${JSON.stringify(value)})`),
  );
}

async function fillMeasuresIfPresent(
  page: Page,
  widthCm?: number | null,
  lengthCm?: number | null,
  heightCm?: number | null,
): Promise<void> {
  if (widthCm == null || lengthCm == null || heightCm == null) return;
  const w = String(Math.round(widthCm));
  const l = String(Math.round(lengthCm));
  const h = String(Math.round(heightCm));
  await fillWallaTextInput(page, "#width, input[name=width]", w);
  await fillWallaTextInput(page, "#length, input[name=length]", l);
  await fillWallaTextInput(page, "#height, input[name=height]", h);
}

/**
 * Stencil `walla-radio` hydrates the `<input>` in light DOM (`aria-label`).
 * `value` is the option payload (`false` = Estándar, `true` = Voluminoso), not
 * checked state — only Playwright `isChecked()` / `HTMLInputElement.checked`.
 * `exact: true` is required: kg radios are named "Delivery Option N" and would
 * otherwise substring-match `name: "delivery"`.
 */
async function clickRoleRadio(page: Page, name: string): Promise<void> {
  const radio = page.getByRole("radio", { name, exact: true }).first();
  await radio.waitFor({ state: "visible", timeout: 8_000 });
  await radio.scrollIntoViewIfNeeded();
  await radio.click({ timeout: 5_000 });
}

async function roleRadioIsChecked(page: Page, name: string): Promise<boolean> {
  const radio = page.getByRole("radio", { name, exact: true }).first();
  if (!(await radio.count().catch(() => 0))) return false;
  return Boolean(await radio.isChecked().catch(() => false));
}

async function clickWeightBandByLabel(
  page: Page,
  labelNeedle: string,
): Promise<void> {
  const ariaName = wallapopStandardWeightBandAriaName(labelNeedle);
  if (!ariaName) {
    throw new WallapopPublishError(
      "form",
      `Tramo de peso desconocido (${labelNeedle}).`,
    );
  }
  await clickRoleRadio(page, ariaName);
}

async function isStandardWeightBandSelected(
  page: Page,
  labelNeedle: string,
): Promise<boolean> {
  const ariaName = wallapopStandardWeightBandAriaName(labelNeedle);
  if (!ariaName) return false;
  return roleRadioIsChecked(page, ariaName);
}

async function ensureStandardWeightBand(
  page: Page,
  weightKg: number,
): Promise<string> {
  const labelNeedle = wallapopStandardWeightBandFromCrm(weightKg);
  if (!labelNeedle) {
    throw new WallapopPublishError(
      "form",
      "El peso es demasiado alto para envío estándar (máx. 30 kg, incluido el envoltorio).",
    );
  }

  try {
    await page
      .getByText(/Cuánto pesa|How much (does it )?weigh|Скільки важить/i)
      .first()
      .waitFor({ state: "visible", timeout: 8_000 });
    await page
      .getByRole("radio", { name: "Delivery Option 0", exact: true })
      .first()
      .waitFor({ state: "visible", timeout: 5_000 });
  } catch {
    throw new WallapopPublishError(
      "form",
      "No apareció el selector de tramo de peso (¿Cuánto pesa?).",
    );
  }

  if (await isStandardWeightBandSelected(page, labelNeedle)) return labelNeedle;

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await clickWeightBandByLabel(page, labelNeedle);
    } catch (err) {
      log("warn", "wallapop_publish_weight_band_click_fail", {
        labelNeedle,
        attempt,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    await page.waitForTimeout(700);
    if (await isStandardWeightBandSelected(page, labelNeedle))
      return labelNeedle;
  }

  throw new WallapopPublishError(
    "form",
    `No se pudo seleccionar el tramo de peso (${labelNeedle}).`,
  );
}

async function assertShippingReadyForPublish(
  page: Page,
  weightBandLabel?: string | null,
): Promise<void> {
  if (!weightBandLabel) return;
  if (!(await isStandardWeightBandSelected(page, weightBandLabel))) {
    throw new WallapopPublishError(
      "form",
      `Selecciona el tramo de peso (${weightBandLabel}).`,
    );
  }
}

async function ensureMaterialOtro(page: Page): Promise<void> {
  const body = (await page.evaluate(
    `document.body ? document.body.innerText : ""`,
  )) as string;
  if (/Material/i.test(body) && !/Otro|Madera|Metal|Plástico/i.test(body)) {
    await clickMainText(page, "Material");
    await page.waitForTimeout(300);
    await clickMainText(page, "Otro");
  }
}

async function finalButtonVisible(page: Page): Promise<boolean> {
  const texts = (await page.evaluate(`(() => {
    const visible = (el) => {
      const s = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0;
    };
    const labelOf = (el) => {
      const shadowBtn = el.shadowRoot?.querySelector?.("button");
      return (
        el.innerText ||
        el.getAttribute("aria-label") ||
        el.getAttribute("text") ||
        shadowBtn?.innerText ||
        shadowBtn?.getAttribute("aria-label") ||
        ""
      )
        .trim()
        .replace(/\\s+/g, " ")
        .slice(0, 100);
    };
    return [...document.querySelectorAll("button, [role=button], walla-button")]
      .filter(visible)
      .map(labelOf)
      .filter(Boolean);
  })()`)) as string[];
  return texts.some((t) => FINAL_RE.test(t));
}

async function clickFinalPublish(page: Page): Promise<boolean> {
  const finalPattern = JSON.stringify(FINAL_RE.source);
  const finalFlags = JSON.stringify(FINAL_RE.flags);
  try {
    const clicked = await page.evaluate(`(() => {
    const re = new RegExp(${finalPattern}, ${finalFlags});
    const visible = (el) => {
      const s = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0;
    };
    const labelOf = (el) => {
      const shadowBtn = el.shadowRoot?.querySelector?.("button");
      return (
        el.innerText ||
        el.getAttribute("aria-label") ||
        el.getAttribute("text") ||
        shadowBtn?.innerText ||
        shadowBtn?.getAttribute("aria-label") ||
        ""
      )
        .trim()
        .replace(/\\s+/g, " ");
    };
    const nodes = [...document.querySelectorAll("button, [role=button], walla-button")];
    for (const el of nodes) {
      if (!visible(el)) continue;
      if (!re.test(labelOf(el))) continue;
      const target = el.shadowRoot?.querySelector?.("button") || el;
      target.click();
      return true;
    }
    return false;
  })()`);
    return Boolean(clicked);
  } catch (error) {
    if (isPublicarContextDestroyedError(error)) {
      log("warn", "wallapop_publish_publicar_evaluate_torn_down", {
        message: error instanceof Error ? error.message : String(error),
      });
      // DOM click may have already run; Node never got `true`. Prefer stuck POSTING over a duplicate.
      return true;
    }
    throw error;
  }
}

export async function publishWallapopInBrowser(
  input: PublishWallapopInput,
): Promise<PublishWallapopResult> {
  if (!input.imagePaths.length) {
    throw new WallapopPublishError(
      "photos",
      "El producto no tiene fotos en disco.",
    );
  }

  try {
    return await runWithBrowserBusy("publish", () =>
      publishWallapopInBrowserInner(input),
    );
  } finally {
    if (input.dryRun) {
      await closeWallapopUploadTab();
    } else {
      await quitWallapopChrome();
    }
  }
}

async function publishWallapopInBrowserInner(
  input: PublishWallapopInput,
): Promise<PublishWallapopResult> {
  const page = await ensureWallapopPage();
  return publishWallapopInBrowserAfterAttach(input, page);
}

async function publishWallapopInBrowserAfterAttach(
  input: PublishWallapopInput,
  page: Page,
): Promise<PublishWallapopResult> {
  let step: PublishStep = "attach";
  await dismissWallapopConsent(page);
  await dismissSearchOverlay(page);

  step = "upload_entry";
  await navigateViaAssign(page, UPLOAD_URL);
  await dismissWallapopConsent(page);
  await dismissSearchOverlay(page);

  step = "consumer_goods";
  if (!page.url().includes("consumer-goods")) {
    const ok = await clickExactButtonText(page, "Algo que ya no necesito");
    if (!ok) {
      const byRole = page.getByRole("button", {
        name: "Algo que ya no necesito",
        exact: true,
      });
      if (await byRole.isVisible().catch(() => false)) {
        await byRole.click({ force: true });
        await page.waitForTimeout(2_500);
      } else {
        throw new WallapopPublishError(
          step,
          'No se encontró "Algo que ya no necesito".',
        );
      }
    }
  }

  step = "summary";
  const summaryText = truncateSummary(input.title);
  const summary = await firstVisible(page, PUBLISH_SELECTORS.summary, 12_000);
  if (!summary) {
    throw new WallapopPublishError(
      step,
      "No se encontró el campo Resumen (#summary).",
    );
  }
  await summary.fill(summaryText, { force: true });
  await page.waitForTimeout(500);

  let cont = await clickEnabledContinuar(page);
  if (cont === "NONE") {
    throw new WallapopPublishError(
      step,
      "Continuar deshabilitado tras rellenar el resumen.",
    );
  }

  step = "photos";
  const fileInput = page.locator('input[type="file"]').first();
  if (!(await fileInput.count())) {
    throw new WallapopPublishError(step, "No hay input[type=file] para fotos.");
  }
  const paths = input.imagePaths.slice(0, 10);
  await fileInput.setInputFiles(paths);
  log("info", "wallapop_publish_photos_set", { count: paths.length });
  await page.waitForTimeout(8_000);

  cont = await clickEnabledContinuar(page);
  if (cont === "NONE") {
    throw new WallapopPublishError(
      step,
      "Continuar deshabilitado tras subir las fotos.",
    );
  }
  if (cont === "FINAL") {
    throw new WallapopPublishError(
      step,
      "Apareció Publicar demasiado pronto tras las fotos.",
    );
  }

  step = "form";
  logPublishStep(step, page, { phase: "form_start" });
  await ensureCategorySelected(page, input.categoryLabels);

  const descriptionText = input.description?.trim() || summaryText;
  await fillIfEmpty(page, PUBLISH_SELECTORS.title, summaryText);
  await fillPublishDescription(page, descriptionText);
  // Estado first: product-info section is stable; then Precio (#price_amount).
  await ensureEstado(page, estadoLabel(input.condition));
  await fillPrice(page, input.price);
  await ensureMaterialOtro(page);
  const packageType = input.packageType ?? "STANDARD";
  let weightBandLabel: string | null = null;
  if (packageType === "STANDARD") {
    if (input.weightKg == null) {
      throw new WallapopPublishError(
        "form",
        "Indica el peso del producto antes de publicar con envío.",
      );
    }
    await page.evaluate(`window.scrollBy(0, 500)`).catch(() => {});
    weightBandLabel = await ensureStandardWeightBand(page, input.weightKg);
  }
  await fillMeasuresIfPresent(
    page,
    input.widthCm,
    input.lengthCm,
    input.heightCm,
  );

  if (input.brand?.trim()) {
    await fillIfEmpty(
      page,
      [
        'input[name="brand"]',
        'input[aria-label*="Marca" i]',
        'input[placeholder*="Marca" i]',
      ],
      input.brand.trim(),
    );
  }

  await clickMainText(page, "No lo es");

  if (!(await readPriceAmount(page))) {
    await fillPrice(page, input.price);
  }

  logPublishStep(step, page, {
    phase: "form_before_continuar_loop",
    price: await readPriceAmount(page),
    condition: await page
      .locator("#condition")
      .inputValue()
      .catch(() => ""),
    packageType,
    weightKg: input.weightKg ?? null,
    weightBandLabel,
    weightBandSelected: weightBandLabel
      ? await isStandardWeightBandSelected(page, weightBandLabel)
      : false,
    delivery: await roleRadioIsChecked(page, "delivery"),
    bulky: await roleRadioIsChecked(page, "bulky"),
  });

  for (let round = 0; round < 14; round++) {
    if (await finalButtonVisible(page)) {
      step = "before_publicar";
      break;
    }
    await page.evaluate(`window.scrollBy(0, 350)`);
    const r = await clickEnabledContinuar(page);
    if (r === "FINAL") {
      step = "before_publicar";
      break;
    }
    if (r === "NONE" && round > 4) {
      if (await finalButtonVisible(page)) {
        step = "before_publicar";
        break;
      }
    }
  }

  if (step !== "before_publicar" && !(await finalButtonVisible(page))) {
    if (
      (await categorySectionVisible(page)) &&
      (await categoryPickerStillEmpty(page))
    ) {
      throw new WallapopPublishError(
        step,
        "Categoría no seleccionada; no aparece el botón Publicar.",
      );
    }
    const formState = (await page.evaluate(`(() => ({
      condition: document.querySelector("#condition")?.value || "",
      price: document.querySelector("#price_amount")?.value || "",
      categoryLeaf: document.querySelector("#category_leaf_id")?.value || "",
      delivery: Boolean(document.querySelector("#delivery")?.checked),
      bulky: Boolean(document.querySelector("#bulky")?.checked),
    }))()`)) as {
      condition: string;
      price: string;
      categoryLeaf: string;
      delivery: boolean;
      bulky: boolean;
    };
    const visibleButtons = await visibleButtonLabels(page);
    log("warn", "wallapop_publish_no_publicar", {
      step,
      visibleButtons,
      formState,
    });
    throw new WallapopPublishError(
      step,
      "No apareció el botón Publicar (dry-run stop).",
    );
  }
  step = "before_publicar";

  await assertShippingReadyForPublish(page, weightBandLabel);
  await ensureCrmDescriptionOnForm(page, descriptionText, "before_publicar");

  log("info", "wallapop_publish_before_publicar", {
    dryRun: input.dryRun,
    url: page.url(),
  });

  if (input.dryRun) {
    return {
      ok: true,
      dryRun: true,
      step: "before_publicar",
      externalUrl: null,
    };
  }

  const published = await clickFinalPublish(page);
  if (!published) {
    throw new WallapopPublishError(
      "before_publicar",
      "No se pudo hacer click en Publicar.",
    );
  }

  const externalUrl = await readUrlAfterPublicarClick(page);
  return {
    ok: true,
    dryRun: false,
    step: "published",
    externalUrl,
  };
}
