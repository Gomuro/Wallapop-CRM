/**
 * Wallapop consumer-goods publish via Chrome CDP.
 * Imports only wallapop-cdp primitives (not login SELECTORS).
 * Research: Desk/.../autopost-research/PUBLISH-FLOW-RESEARCH.md
 */
import type { Page } from "playwright";

import {
  closeWallapopUploadTab,
  consumeKeepChromeAfterAbort,
  dismissWallapopConsent,
  ensureWallapopPage,
  firstVisible,
  isInFlightPublishAborted,
  isPublishAbortedError,
  navigateViaAssign,
  PublishAbortedError,
  quitWallapopChrome,
  runWithBrowserBusy,
  throwIfPublishAborted,
} from "./wallapop-cdp";
import { log, serializeError } from "./log";
import { crmDescriptionMatchesForm } from "./wallapop-description";
import {
  wallapopStandardWeightBandAriaName,
  wallapopStandardWeightBandFromCrm,
} from "./wallapop-weight-band";
import { wallapopItemUrlOrNull } from "../../../lib/inventory/wallapop-item-url";
import { wallapopBrandFromProduct } from "../../../lib/inventory/wallapop-brand";

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
  /** True: Publicar may have run; keep POSTING, do not write ACTIVE. */
  keepClaim: boolean;
  constructor(
    step: PublishStep,
    message: string,
    opts?: { keepClaim?: boolean },
  ) {
    super(message);
    this.name = "WallapopPublishError";
    this.step = step;
    this.keepClaim = opts?.keepClaim === true;
  }
}

const PUBLICAR_SETTLE_MS = 5_000;

export type PageUrlReader = {
  url: () => string;
  waitForTimeout: (ms: number) => Promise<void>;
};

export function listingUrlFromPageUrl(url: string): string | null {
  return wallapopItemUrlOrNull(url);
}

export function isWallapopPublishedCatalogUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host !== "wallapop.com" && !host.endsWith(".wallapop.com")) return false;
    return /\/app\/catalog\/published(\/|$)/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function isWallapopUploadFormUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /\/upload(\/|$)/i.test(parsed.pathname);
  } catch {
    return /\/upload/i.test(url);
  }
}

export type PublishLandingReason =
  | "published_catalog"
  | "item_url"
  | "still_on_upload"
  | "review_banner"
  | "target_closed"
  | "unexpected_url";

export type PublishLandingVerdict =
  | { ok: true; reason: "published_catalog" | "item_url" }
  | {
      ok: false;
      reason: "still_on_upload" | "review_banner" | "target_closed" | "unexpected_url";
      message: string;
    };

/** D9: post exists only on Tu Catálogo published (or rare /item/ redirect). */
export function classifyPublishLanding(input: {
  url: string | null;
  urlReadFailed: boolean;
  reviewMessage: string | null;
}): PublishLandingVerdict {
  if (input.urlReadFailed || input.url == null || input.url.trim() === "") {
    return {
      ok: false,
      reason: "target_closed",
      message:
        "No se pudo comprobar el catálogo tras Publicar (pestaña cerrada). El listing no se marcó ACTIVE.",
    };
  }
  if (input.reviewMessage) {
    return {
      ok: false,
      reason: "review_banner",
      message: input.reviewMessage,
    };
  }
  if (isWallapopUploadFormUrl(input.url)) {
    return {
      ok: false,
      reason: "still_on_upload",
      message:
        "Wallapop no publicó el anuncio; el formulario de alta sigue abierto.",
    };
  }
  if (isWallapopPublishedCatalogUrl(input.url)) {
    return { ok: true, reason: "published_catalog" };
  }
  if (wallapopItemUrlOrNull(input.url)) {
    return { ok: true, reason: "item_url" };
  }
  return {
    ok: false,
    reason: "unexpected_url",
    message: `Tras Publicar la página no es el catálogo publicado (${input.url}). El listing no se marcó ACTIVE.`,
  };
}

function safePageUrl(page: Page): string {
  try {
    return page.url();
  } catch {
    return "";
  }
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
 * After Publicar: wait, then read the landing URL.
 * Target closed → urlReadFailed (D9: not ACTIVE).
 */
export async function readLandingAfterPublicarClick(
  page: PageUrlReader,
  settleMs = PUBLICAR_SETTLE_MS,
): Promise<{ url: string | null; urlReadFailed: boolean }> {
  try {
    await page.waitForTimeout(settleMs);
    const url = page.url();
    return { url: url || null, urlReadFailed: !url };
  } catch (error) {
    log("warn", "wallapop_publish_url_after_publicar_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    if (isPublicarContextDestroyedError(error)) {
      return { url: null, urlReadFailed: true };
    }
    throw error;
  }
}

export async function readUrlAfterPublicarClick(
  page: PageUrlReader,
  settleMs = PUBLICAR_SETTLE_MS,
): Promise<string | null> {
  const landing = await readLandingAfterPublicarClick(page, settleMs);
  if (landing.urlReadFailed || landing.url == null) return null;
  return listingUrlFromPageUrl(landing.url);
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

/** Compact DOM snapshot for VPS logs — no debugger on the Windows box. */
async function snapshotPublishForm(
  page: Page,
  preferredNeedle?: string,
): Promise<Record<string, unknown>> {
  try {
    return (await page.evaluate(`((preferredNeedle) => {
      const RADIUS = 100;
      const text = document.body ? document.body.innerText : "";
      const boxes = [...document.querySelectorAll("wallapop-toggle input[type=checkbox]")];
      const radios = [...document.querySelectorAll("input[type=radio]")].slice(0, 24).map((el) => ({
        id: el.id || "",
        aria: el.getAttribute("aria-label") || "",
        checked: el.checked,
        value: el.value,
      }));
      const needles = [
        preferredNeedle,
        "cuánto pesa",
        "cuanto pesa",
        "activar envío",
        "activar envio",
        "opciones de envío",
        "opciones de envio",
        "newweightselector",
        "wallapop-toggle",
        "standarddescription",
        "delivery option",
        'id="delivery"',
        "estándar",
        "voluminoso",
        'id="condition"',
        "como nuevo",
      ].filter(Boolean);
      const raw = document.documentElement ? document.documentElement.outerHTML : "";
      const pretty = raw.replace(/></g, ">\\n<");
      const lines = pretty.split("\\n");
      const lower = lines.map((ln) => ln.toLowerCase());
      let hit = -1;
      let needle = "";
      for (const n of needles) {
        hit = lower.findIndex((ln) => ln.includes(n));
        if (hit >= 0) {
          needle = n;
          break;
        }
      }
      if (hit < 0) hit = Math.max(0, Math.floor(lines.length / 2));
      const from = Math.max(0, hit - RADIUS);
      const to = Math.min(lines.length, hit + RADIUS + 1);
      const htmlAround = lines.slice(from, to).map((ln) => ln.slice(0, 400)).join("\\n");
      return {
        title: document.title,
        hasCuantoPesa: /Cuánto pesa|How much/i.test(text),
        hasActivarEnvio: /Activar envío/i.test(text),
        hasEstandar: /Estándar/i.test(text),
        hasVoluminoso: /Voluminoso/i.test(text),
        toggleChecked: boxes.map((el) => el.checked),
        radios,
        condition: document.querySelector("#condition")?.value || "",
        price: document.querySelector("#price_amount")?.value || "",
        categoryLeaf: document.querySelector("#category_leaf_id")?.value || "",
        htmlNeedle: needle || "(mid-page fallback)",
        htmlHitLine: hit,
        htmlFromLine: from,
        htmlToLine: to,
        htmlTotalLines: lines.length,
        htmlAround,
      };
    })(${JSON.stringify(preferredNeedle ?? "")})`)) as Record<string, unknown>;
  } catch (error) {
    return {
      snapshotError: error instanceof Error ? error.message : String(error),
    };
  }
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

async function readConditionValue(page: Page): Promise<string> {
  return (await page.locator("#condition").first().inputValue().catch(() => "")) || "";
}

async function closeOpenDropdowns(page: Page): Promise<void> {
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(250);
}

/** Options inside one Wallapop field. Never scans photo drop-areas. */
const DROPDOWN_ROOT_JS: Record<"condition" | "marca", string> = {
  condition: `document.querySelector("#condition")?.closest("walla-dropdown, tsl-upload-form-dropdown") || document.querySelector('walla-dropdown[data-testid="condition"]')`,
  marca: `(() => {
    const labels = [...document.querySelectorAll("label")];
    const lab = labels.find((el) => /Marca\\s*\\*/i.test(el.textContent || ""));
    const forId = lab?.getAttribute("for");
    const input =
      (forId && document.getElementById(forId)) ||
      lab?.closest(".inputWrapper")?.querySelector("input") ||
      null;
    return (
      input?.closest(
        "wallapop-combo-box, walla-combo-box, .sc-wallapop-combo-box, tsl-upload-form-field-host",
      ) ||
      null
    );
  })()`,
};

function optionScanJs(rootExpr: string): string {
  return `(() => {
    const root = ${rootExpr};
    if (!root) return [];
    const text = (el) =>
      (el.getAttribute("aria-label") || el.textContent || "")
        .replace(/\\s+/g, " ")
        .trim();
    return [
      ...root.querySelectorAll(
        'walla-dropdown-item[role="option"], [role="listbox"] [role="option"]',
      ),
    ]
      .filter(
        (el) =>
          el.getAttribute("aria-disabled") !== "true" &&
          !/drop area/i.test(text(el)),
      )
      .map(text)
      .filter(Boolean)
      .slice(0, 20);
  })()`;
}

async function listOpenDropdownOptions(page: Page): Promise<string[]> {
  return (await page.evaluate(
    optionScanJs(`document`),
  )) as string[];
}

async function listFieldDropdownOptions(
  page: Page,
  field: "condition" | "marca",
): Promise<string[]> {
  return (await page.evaluate(
    optionScanJs(DROPDOWN_ROOT_JS[field]),
  )) as string[];
}

/** Open the dropdown bound to a hidden input (#condition, #brand). */
async function openHiddenFieldDropdown(
  page: Page,
  hiddenId: string,
): Promise<boolean> {
  await closeOpenDropdowns(page);
  const opened = (await page.evaluate(`((hiddenId) => {
    const hidden = document.querySelector("#" + hiddenId);
    if (!hidden) return false;
    const host =
      hidden.closest("tsl-dropdown-form, [formcontrolname]") ||
      hidden.parentElement;
    const dd =
      hidden.closest("walla-dropdown") ||
      host?.querySelector?.("walla-dropdown") ||
      host?.parentElement?.querySelector?.("walla-dropdown");
    const btn =
      dd?.querySelector?.('[role="button"]') ||
      host?.querySelector?.('[role="button"]') ||
      dd;
    if (!btn) return false;
    btn.scrollIntoView?.({ block: "center" });
    btn.click?.();
    return true;
  })(${JSON.stringify(hiddenId)})`)) as boolean;
  await page.waitForTimeout(900);
  return Boolean(opened);
}

async function clickListboxOptionInRoot(
  page: Page,
  label: string,
  rootExpr: string,
): Promise<boolean> {
  const clicked = (await page.evaluate(`((label) => {
    const root = ${rootExpr};
    if (!root) return false;
    const norm = (s) =>
      (s || "")
        .replace(/[\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]/g, "")
        .replace(/\\s+/g, " ")
        .trim()
        .toLowerCase();
    const wanted = norm(label);
    const text = (el) =>
      (el.getAttribute("aria-label") || el.textContent || "")
        .replace(/\\s+/g, " ")
        .trim();
    const items = [
      ...root.querySelectorAll(
        'walla-dropdown-item[role="option"], [role="listbox"] [role="option"]',
      ),
    ].filter(
      (el) =>
        el.getAttribute("aria-disabled") !== "true" &&
        !/drop area/i.test(text(el)),
    );
    const match = items.find((el) => {
      const aria = norm(el.getAttribute("aria-label"));
      const body = norm(el.textContent);
      return (
        aria === wanted ||
        body === wanted ||
        aria.startsWith(wanted) ||
        body.startsWith(wanted) ||
        aria.includes(wanted) ||
        body.includes(wanted)
      );
    });
    if (!match) return false;
    match.click();
    return true;
  })(${JSON.stringify(label)})`)) as boolean;
  if (clicked) await page.waitForTimeout(1_000);
  return Boolean(clicked);
}

async function clickOpenListboxOption(
  page: Page,
  label: string,
): Promise<boolean> {
  return clickListboxOptionInRoot(page, label, "document");
}

async function clickFieldDropdownOption(
  page: Page,
  field: "condition" | "marca",
  label: string,
): Promise<boolean> {
  return clickListboxOptionInRoot(page, label, DROPDOWN_ROOT_JS[field]);
}

async function openEstadoDropdown(page: Page): Promise<boolean> {
  return openHiddenFieldDropdown(page, "condition");
}

async function clickEstadoOption(page: Page, label: string): Promise<boolean> {
  return clickFieldDropdownOption(page, "condition", label);
}

async function ensureEstado(page: Page, label: string): Promise<void> {
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

async function queryMarcaCombo(page: Page): Promise<{
  id: string;
  value: string;
} | null> {
  return (await page.evaluate(`(() => {
    const labels = [...document.querySelectorAll("label")];
    const label = labels.find((el) => /Marca\\s*\\*/i.test(el.textContent || ""));
    if (!label) return null;
    const forId = label.getAttribute("for");
    const input =
      (forId && document.getElementById(forId)) ||
      label.closest(".inputWrapper")?.querySelector("input") ||
      null;
    if (!(input instanceof HTMLInputElement)) return null;
    return { id: input.id || "", value: String(input.value || "").trim() };
  })()`)) as { id: string; value: string } | null;
}

async function readBrandValue(page: Page): Promise<string> {
  return (
    ((await page.evaluate(`(() => {
      const clip = (s) => String(s || "").replace(/\\s+/g, " ").trim();
      const hidden = document.querySelector("#brand, input[name='brand']");
      if (hidden instanceof HTMLInputElement && clip(hidden.value)) {
        return clip(hidden.value);
      }
      const selected = [
        ...document.querySelectorAll(
          "wallapop-combo-box-item[aria-selected='true'], wallapop-combo-box-item[aria-checked='true']",
        ),
      ][0];
      const fromItem = clip(
        selected?.getAttribute("aria-label") || selected?.textContent,
      );
      if (fromItem) return fromItem;
      return "";
    })()`)) as string) || ""
  );
}

async function marcaFieldShown(page: Page): Promise<boolean> {
  if (await queryMarcaCombo(page)) return true;
  return Boolean(
    await page.evaluate(`(() => {
      if (document.querySelector("#brand, input[name='brand'], [formcontrolname='brand']")) {
        return true;
      }
      const text = document.body ? document.body.innerText : "";
      return /Marca\\s*\\*/.test(text);
    })()`),
  );
}

async function dumpMarcaCombo(page: Page, phase: string): Promise<void> {
  try {
    const dump = (await page.evaluate(`(() => {
      const clip = (s, n) => String(s || "").replace(/\\s+/g, " ").trim().slice(0, n);
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return (
          r.width > 2 &&
          r.height > 2 &&
          s.visibility !== "hidden" &&
          s.display !== "none" &&
          Number(s.opacity || "1") > 0
        );
      };
      const labels = [...document.querySelectorAll("label")];
      const lab = labels.find((el) => /Marca\\s*\\*/i.test(el.textContent || ""));
      const forId = lab?.getAttribute("for") || "";
      const input = forId ? document.getElementById(forId) : null;
      const host =
        input?.closest(
          "tsl-upload-form-field-host, wallapop-combo-box, walla-combo-box, walla-text-input",
        ) || null;
      const bodyText = document.body ? document.body.innerText : "";
      const floating = [...document.querySelectorAll("walla-floating-area")].map((el) => ({
        cls: clip(el.className, 160),
        closed: /wrapper--closed|wrapper--hidden/.test(String(el.className || "")),
        vis: vis(el),
        text: clip(el.innerText, 220),
        optionCount: el.querySelectorAll(
          '[role="option"], walla-dropdown-item, walla-list-item, wallapop-combo-box-item',
        ).length,
      }));
      const roleOptions = [...document.querySelectorAll('[role="option"]')]
        .slice(0, 25)
        .map((el) => ({
          tag: el.tagName,
          aria: clip(el.getAttribute("aria-label"), 80),
          text: clip(el.textContent, 80),
          vis: vis(el),
        }));
      const openPanel = [...document.querySelectorAll("walla-floating-area")].find(
        (el) => vis(el) && !/wrapper--closed/.test(String(el.className || "")),
      );
      const panelLines = clip(openPanel?.innerText, 500)
        .split(/(?<=\\S)\\s{2,}|(?=Seleccione)/)
        .map((t) => clip(t, 80))
        .filter(Boolean)
        .slice(0, 20);
      return {
        inputId: input && "id" in input ? String(input.id || forId) : forId || null,
        inputValue:
          input instanceof HTMLInputElement ? String(input.value || "") : "",
        inputMode: input?.getAttribute?.("inputmode") || null,
        hostTag: host?.tagName || null,
        hostClass: clip(host?.className, 120),
        hasSeleccioneHasta: /Seleccione hasta/i.test(bodyText),
        comboBoxCount: document.querySelectorAll(
          "wallapop-combo-box, walla-combo-box",
        ).length,
        roleOptionCount: document.querySelectorAll('[role="option"]').length,
        dropdownItemCount: document.querySelectorAll("walla-dropdown-item").length,
        listItemCount: document.querySelectorAll("walla-list-item").length,
        comboItemCount: document.querySelectorAll("wallapop-combo-box-item").length,
        hasCrear: /Crear\\s/i.test(bodyText),
        hasNoResult: /No se ha encontrado/i.test(bodyText),
        comboItemSample: [...document.querySelectorAll("wallapop-combo-box-item")]
          .slice(0, 8)
          .map((el) => clip(el.getAttribute("aria-label") || el.textContent, 60)),
        floating,
        roleOptions,
        panelLines,
        panelHtml: clip(openPanel?.outerHTML, 900),
        hostHtml: clip(host?.outerHTML, 700),
      };
    })()`)) as Record<string, unknown>;
    log("info", "wallapop_publish_marca_dump", { phase, ...dump });
  } catch (err) {
    log("warn", "wallapop_publish_marca_dump_failed", {
      phase,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

async function typeMarcaCombo(
  page: Page,
  inputId: string,
  wanted: string,
): Promise<void> {
  await page.evaluate(`((id) => {
    const el = document.getElementById(id);
    if (!(el instanceof HTMLInputElement)) return false;
    const header = document.querySelector(".PrivateLayout__header, tsl-topbar");
    const headerH = header ? header.getBoundingClientRect().height : 0;
    el.scrollIntoView({ block: "center", inline: "nearest" });
    const top = el.getBoundingClientRect().top;
    if (top < headerH + 12) window.scrollBy(0, top - headerH - 24);
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter ? setter.call(el, "") : (el.value = "");
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
    return true;
  })(${JSON.stringify(inputId)})`);
  await page.keyboard.type(wanted, { delay: 40 });
  const typed = await page.evaluate(
    `((id) => {
      const el = document.getElementById(id);
      return el instanceof HTMLInputElement ? el.value : "";
    })(${JSON.stringify(inputId)})`,
  );
  log("info", "wallapop_publish_marca_type", {
    step: "typed",
    inputId,
    wanted,
    value: typed,
  });
  await page.waitForTimeout(800);
  await dumpMarcaCombo(page, "after_type");
}

function marcaCrearScanJs(wanted: string): string {
  return `((wanted) => {
    const want = String(wanted || "").toLowerCase();
    const clip = (s) => String(s || "").replace(/\\s+/g, " ").trim();
    const walk = (root, acc) => {
      if (!root || !root.querySelectorAll) return acc;
      for (const el of root.querySelectorAll("*")) {
        acc.push(el);
        if (el.shadowRoot) walk(el.shadowRoot, acc);
      }
      return acc;
    };
    const nodes = walk(document, []);
    const hits = nodes
      .map((el) => ({ el, text: clip(el.textContent) }))
      .filter((row) => /^Crear\\b/i.test(row.text) && row.text.length < 80);
    const match =
      hits.find((row) => row.text.toLowerCase().includes(want)) || hits[0];
    if (!match) {
      return { clicked: false, hits: hits.map((row) => row.text).slice(0, 8) };
    }
    match.el.click();
    match.el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
    );
    return { clicked: true, text: match.text, hits: hits.map((row) => row.text).slice(0, 8) };
  })(${JSON.stringify(wanted)})`;
}

async function clickMarcaCatalogItem(
  page: Page,
  wanted: string,
): Promise<boolean> {
  const clicked = (await page.evaluate(`((wanted) => {
    const want = String(wanted || "").toLowerCase();
    const items = [...document.querySelectorAll("wallapop-combo-box-item")];
    const match = items.find((el) => {
      const aria = (el.getAttribute("aria-label") || "").trim().toLowerCase();
      return aria === want;
    });
    if (!match) return false;
    match.click();
    return true;
  })(${JSON.stringify(wanted)})`)) as boolean;
  if (clicked) await page.waitForTimeout(500);
  return Boolean(clicked);
}

async function clickMarcaCrear(page: Page, wanted: string): Promise<boolean> {
  const result = (await page.evaluate(marcaCrearScanJs(wanted))) as {
    clicked?: boolean;
    text?: string;
    hits?: string[];
  };
  log("info", "wallapop_publish_marca_crear_scan", {
    wanted,
    clicked: Boolean(result?.clicked),
    text: result?.text || null,
    hits: result?.hits || [],
  });
  if (result?.clicked) {
    await page.waitForTimeout(700);
    log("info", "wallapop_publish_marca_crear_clicked", {
      wanted,
      via: "shadow",
      text: result.text,
    });
    return true;
  }
  return false;
}

async function pickMarcaSuggestion(
  page: Page,
  wanted: string,
): Promise<boolean> {
  if (await clickMarcaCatalogItem(page, wanted)) return true;
  for (let attempt = 0; attempt < 6; attempt++) {
    if (await clickMarcaCrear(page, wanted)) return true;
    await page.waitForTimeout(400);
  }
  return Boolean((await readBrandValue(page)).trim());
}

async function marcaLooksSelected(page: Page, wanted: string): Promise<boolean> {
  if ((await readBrandValue(page)).toLowerCase() === wanted.toLowerCase()) {
    return true;
  }
  return Boolean(
    await page.evaluate(`((wanted) => {
      const want = String(wanted || "").toLowerCase();
      const combo = document.querySelector("wallapop-combo-box");
      const text = (combo?.innerText || "").replace(/\\s+/g, " ").toLowerCase();
      if (!text.includes(want)) return false;
      if (/no se ha encontrado/.test(text)) return false;
      const host = combo?.querySelector(".inputWrapper");
      return Boolean(host && /inputWrapper--filled/.test(host.className || ""));
    })(${JSON.stringify(wanted)})`),
  );
}

async function ensureMarcaIfShown(
  page: Page,
  brand?: string | null,
): Promise<void> {
  if (!(await marcaFieldShown(page))) {
    log("info", "wallapop_publish_marca_skip", { reason: "field_absent" });
    return;
  }
  if ((await readBrandValue(page)).trim()) {
    log("info", "wallapop_publish_marca_already", {
      value: await readBrandValue(page),
    });
    return;
  }

  await closeOpenDropdowns(page);
  const wanted =
    brand?.trim() ||
    wallapopBrandFromProduct({
      description: await readPublishDescription(page),
    }) ||
    "";
  const combo = await queryMarcaCombo(page);
    log("info", "wallapop_publish_marca_field", {
    wanted: wanted || null,
    comboId: combo?.id || null,
    hasHiddenBrand: Boolean(await page.locator("#brand").count()),
  });
  await dumpMarcaCombo(page, "field_found");
  if (!wanted) {
    throw new WallapopPublishError(
      "form",
      "Wallapop exige Marca en esta categoría. Añádela en el CRM antes de publicar.",
    );
  }

  if (combo?.id) {
    await typeMarcaCombo(page, combo.id, wanted);
    const options = await listFieldDropdownOptions(page, "marca");
    log("info", "wallapop_publish_marca_try", {
      wanted,
      via: "combo",
      options,
    });
    const picked = await pickMarcaSuggestion(page, wanted);
    await dumpMarcaCombo(page, "after_pick");
    const afterPick = await readBrandValue(page);
    const looksSelected = await marcaLooksSelected(page, wanted);
    log("info", "wallapop_publish_marca_pick_result", {
      wanted,
      picked,
      value: afterPick,
      looksSelected,
    });
    if (afterPick.trim() || looksSelected) {
      log("info", "wallapop_publish_marca_selected", {
        wanted,
        value: afterPick || wanted,
        picked,
        looksSelected,
      });
      return;
    }
    await dumpMarcaCombo(page, "before_fail");
    throw new WallapopPublishError(
      "form",
      `No se pudo seleccionar la marca (${wanted}).`,
    );
  }

  await fillIfEmpty(
    page,
    [
      'input[name="brand"]',
      "#brand",
      'input[aria-label*="Marca" i]',
      'input[placeholder*="Marca" i]',
    ],
    wanted,
  );
  if ((await readBrandValue(page)).trim()) return;

  const opened = await openHiddenFieldDropdown(page, "brand");
  const typed = await page.evaluate(`((v) => {
    const el = document.querySelector(
      "#brand, input[name=brand], input[aria-label*='Marca' i]",
    );
    if (!el) return false;
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter ? setter.call(el, v) : (el.value = v);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: v, inputType: "insertText" }));
    return true;
  })(${JSON.stringify(wanted)})`);
  if (typed) await page.keyboard.type(wanted, { delay: 25 }).catch(() => {});
  const options = await listOpenDropdownOptions(page);
  log("info", "wallapop_publish_marca_try", {
    wanted,
    opened,
    typed,
    via: "hidden",
    options,
  });
  await clickOpenListboxOption(page, wanted);
  await page.waitForTimeout(400);
  if ((await readBrandValue(page)).trim()) {
    log("info", "wallapop_publish_marca_selected", {
      wanted,
      value: await readBrandValue(page),
    });
    return;
  }
  await dumpMarcaCombo(page, "before_fail");
  throw new WallapopPublishError(
    "form",
    `No se pudo seleccionar la marca (${wanted}).`,
  );
}

async function wallapopUploadReviewMessage(
  page: Page,
): Promise<string | null> {
  try {
    return (await page.evaluate(`(() => {
      const text = document.body ? document.body.innerText : "";
      if (/Revisa los campos/i.test(text) || /Revisa la información/i.test(text)) {
        return "Wallapop pidió revisar campos en rojo (Marca u otros). El anuncio no se publicó.";
      }
      if (/Campo obligatorio/i.test(text) && /Marca/i.test(text)) {
        return "Falta Marca en Wallapop. El anuncio no se publicó.";
      }
      return null;
    })()`)) as string | null;
  } catch {
    return null;
  }
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
  if (widthCm == null || lengthCm == null || heightCm == null) {
    log("info", "wallapop_publish_measures_skip", {
      widthCm: widthCm ?? null,
      lengthCm: lengthCm ?? null,
      heightCm: heightCm ?? null,
      reason: "missing_one_or_more_cm",
    });
    return;
  }
  const w = String(Math.round(widthCm));
  const l = String(Math.round(lengthCm));
  const h = String(Math.round(heightCm));
  await fillWallaTextInput(page, "#width, input[name=width]", w);
  await fillWallaTextInput(page, "#length, input[name=length]", l);
  await fillWallaTextInput(page, "#height, input[name=height]", h);
  log("info", "wallapop_publish_measures_filled", { widthCm, lengthCm, heightCm });
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

async function roleRadioIsVisible(page: Page, name: string): Promise<boolean> {
  const radio = page.getByRole("radio", { name, exact: true }).first();
  if (!(await radio.count().catch(() => 0))) return false;
  return Boolean(await radio.isVisible().catch(() => false));
}

/**
 * Some categories (jardín / bulky) show Estándar vs Voluminoso first;
 * «¿Cuánto pesa?» only after Estándar. Other categories already show kg bands
 * with no size radios — do not click anything then (Activar envío stays as Wallapop set it).
 */
async function ensurePackageSizeIfShown(
  page: Page,
  packageType: ShippingPackageType,
): Promise<void> {
  const sizeShown =
    (await roleRadioIsVisible(page, "delivery")) ||
    (await roleRadioIsVisible(page, "bulky"));
  const weightShown =
    (await page
      .getByText(/Cuánto pesa|How much (does it )?weigh|Скільки важить/i)
      .first()
      .isVisible()
      .catch(() => false)) ||
    (await roleRadioIsVisible(page, "Delivery Option 0"));

  if (!sizeShown) {
    log("info", "wallapop_publish_package_size_absent", {
      packageType,
      weightShown,
    });
    return;
  }
  if (weightShown) {
    log("info", "wallapop_publish_package_size_skip", {
      packageType,
      reason: "weight_ui_already_visible",
    });
    return;
  }

  const which = packageType === "BULKY" ? "bulky" : "delivery";
  if (await roleRadioIsChecked(page, which)) {
    log("info", "wallapop_publish_package_size_already", { which });
    return;
  }

  log("info", "wallapop_publish_package_size_click", { which, packageType });
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await clickRoleRadio(page, which);
    } catch (err) {
      log("warn", "wallapop_publish_package_radio_click_fail", {
        which,
        attempt,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    await page.waitForTimeout(800);
    if (await roleRadioIsChecked(page, which)) {
      log("info", "wallapop_publish_package_size_selected", { which, attempt });
      return;
    }
  }
  log("warn", "wallapop_publish_package_size_unselected", {
    which,
    ...(await snapshotPublishForm(page)),
    url: page.url(),
  });
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
): Promise<string | null> {
  const labelNeedle = wallapopStandardWeightBandFromCrm(weightKg);
  if (!labelNeedle) {
    throw new WallapopPublishError(
      "form",
      "El peso es demasiado alto para envío estándar (máx. 30 kg, incluido el envoltorio).",
    );
  }

  log("info", "wallapop_publish_weight_try", {
    weightKg,
    labelNeedle,
    aria: wallapopStandardWeightBandAriaName(labelNeedle),
  });

  try {
    await page
      .getByText(/Cuánto pesa|How much (does it )?weigh|Скільки важить/i)
      .first()
      .waitFor({ state: "visible", timeout: 8_000 });
    await page
      .getByRole("radio", { name: "Delivery Option 0", exact: true })
      .first()
      .waitFor({ state: "visible", timeout: 5_000 });
  } catch (error) {
    log("warn", "wallapop_publish_weight_selector_missing", {
      weightKg,
      labelNeedle,
      reason: "cuanto_pesa_or_delivery_option_0_not_visible",
      waitMessage: error instanceof Error ? error.message : String(error),
      ...(await snapshotPublishForm(page)),
      url: page.url(),
    });
    return null;
  }

  if (await isStandardWeightBandSelected(page, labelNeedle)) {
    log("info", "wallapop_publish_weight_already_selected", { labelNeedle });
    return labelNeedle;
  }

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
    if (await isStandardWeightBandSelected(page, labelNeedle)) {
      log("info", "wallapop_publish_weight_selected", {
        labelNeedle,
        attempt,
      });
      return labelNeedle;
    }
  }

  log("error", "wallapop_publish_weight_select_exhausted", {
    weightKg,
    labelNeedle,
    ...(await snapshotPublishForm(page)),
    url: page.url(),
  });
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
  throwIfPublishAborted();
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
    if (isInFlightPublishAborted() || isPublishAbortedError(error)) {
      throw isPublishAbortedError(error)
        ? error
        : new PublishAbortedError();
    }
    if (isPublicarContextDestroyedError(error)) {
      log("warn", "wallapop_publish_publicar_evaluate_torn_down", {
        message: error instanceof Error ? error.message : String(error),
      });
      // DOM click may have already run; Node never got `true`. Verify landing next.
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
    if (consumeKeepChromeAfterAbort()) {
      log("info", "wallapop_chrome_kept_after_abort", { dryRun: input.dryRun });
    } else if (input.dryRun) {
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
  log("info", "wallapop_publish_start", {
    title: input.title.slice(0, 80),
    dryRun: input.dryRun,
    photoCount: input.imagePaths.length,
    packageType: input.packageType ?? "STANDARD",
    weightKg: input.weightKg ?? null,
    widthCm: input.widthCm ?? null,
    lengthCm: input.lengthCm ?? null,
    heightCm: input.heightCm ?? null,
    categoryLabels: input.categoryLabels,
    brand: input.brand ?? null,
    url: page.url(),
  });
  try {
    return await runPublishAfterAttach(input, page, (next) => {
      step = next;
    });
  } catch (error) {
    const failStep =
      error instanceof WallapopPublishError ? error.step : step;
    if (isPublishAbortedError(error) || isInFlightPublishAborted()) {
      log("info", "wallapop_publish_abort", {
        reason: "stop",
        step: failStep,
        message:
          error instanceof Error ? error.message : "Publicación abortada.",
        url: safePageUrl(page),
      });
      throw isPublishAbortedError(error)
        ? error
        : new PublishAbortedError();
    }
    const message = error instanceof Error ? error.message : String(error);
    log("error", "wallapop_publish_abort", {
      step: failStep,
      message,
      unexpected: !(error instanceof WallapopPublishError),
      err: serializeError(error),
      url: safePageUrl(page),
      ...(await snapshotPublishForm(
        page,
        /estado|marca|revisa/i.test(message)
          ? 'id="condition"'
          : undefined,
      )),
    });
    throw error;
  }
}

async function runPublishAfterAttach(
  input: PublishWallapopInput,
  page: Page,
  setStep: (step: PublishStep) => void,
): Promise<PublishWallapopResult> {
  let step: PublishStep = "attach";
  const mark = (next: PublishStep) => {
    throwIfPublishAborted();
    step = next;
    setStep(next);
  };
  throwIfPublishAborted();
  await dismissWallapopConsent(page);
  await dismissSearchOverlay(page);

  mark("upload_entry");
  logPublishStep(step, page, { phase: "goto_upload" });
  await navigateViaAssign(page, UPLOAD_URL);
  await dismissWallapopConsent(page);
  await dismissSearchOverlay(page);

  mark("consumer_goods");
  logPublishStep(step, page, { phase: "consumer_goods_check" });
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

  mark("summary");
  const summaryText = truncateSummary(input.title);
  logPublishStep(step, page, { phase: "summary_fill", summaryText });
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
  logPublishStep(step, page, { phase: "after_summary_continuar", cont });
  if (cont === "NONE") {
    throw new WallapopPublishError(
      step,
      "Continuar deshabilitado tras rellenar el resumen.",
    );
  }

  mark("photos");
  const fileInput = page.locator('input[type="file"]').first();
  if (!(await fileInput.count())) {
    throw new WallapopPublishError(step, "No hay input[type=file] para fotos.");
  }
  const paths = input.imagePaths.slice(0, 10);
  await fileInput.setInputFiles(paths);
  log("info", "wallapop_publish_photos_set", { count: paths.length });
  await page.waitForTimeout(8_000);

  cont = await clickEnabledContinuar(page);
  logPublishStep(step, page, { phase: "after_photos_continuar", cont });
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

  mark("form");
  logPublishStep(step, page, { phase: "form_start" });
  await ensureCategorySelected(page, input.categoryLabels);
  await closeOpenDropdowns(page);
  logPublishStep(step, page, { phase: "after_category" });

  const descriptionText = input.description?.trim() || summaryText;
  await fillIfEmpty(page, PUBLISH_SELECTORS.title, summaryText);
  await fillPublishDescription(page, descriptionText);
  logPublishStep(step, page, { phase: "after_title_description" });
  await ensureEstado(page, estadoLabel(input.condition));
  await fillPrice(page, input.price);
  logPublishStep(step, page, { phase: "after_estado_price" });
  await ensureMarcaIfShown(page, input.brand);
  await ensureMaterialOtro(page);
  const packageType = input.packageType ?? "STANDARD";
  let weightBandLabel: string | null = null;
  await page.evaluate(`window.scrollBy(0, 500)`).catch(() => {});
  await ensurePackageSizeIfShown(page, packageType);
  if (packageType === "STANDARD" && input.weightKg != null) {
    weightBandLabel = await ensureStandardWeightBand(page, input.weightKg);
    logPublishStep(step, page, {
      phase: "after_weight",
      weightKg: input.weightKg,
      weightBandLabel,
    });
  } else {
    log("info", "wallapop_publish_weight_skip", {
      packageType,
      weightKg: input.weightKg ?? null,
      reason:
        packageType !== "STANDARD"
          ? "package_not_standard"
          : "no_weight_kg_in_crm",
    });
  }
  await fillMeasuresIfPresent(
    page,
    input.widthCm,
    input.lengthCm,
    input.heightCm,
  );

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
    throwIfPublishAborted();
    if (await finalButtonVisible(page)) {
      mark("before_publicar");
      logPublishStep(step, page, { phase: "publicar_visible", round });
      break;
    }
    await page.evaluate(`window.scrollBy(0, 350)`);
    const r = await clickEnabledContinuar(page);
    log("info", "wallapop_publish_continuar_round", { round, result: r });
    if (r === "FINAL") {
      mark("before_publicar");
      break;
    }
    if (r === "NONE" && round > 4) {
      if (await finalButtonVisible(page)) {
        mark("before_publicar");
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
      ...(await snapshotPublishForm(page)),
    });
    throw new WallapopPublishError(
      step,
      "No apareció el botón Publicar (dry-run stop).",
    );
  }
  mark("before_publicar");

  await assertShippingReadyForPublish(page, weightBandLabel);
  await ensureCrmDescriptionOnForm(page, descriptionText, "before_publicar");

  log("info", "wallapop_publish_before_publicar", {
    dryRun: input.dryRun,
    url: page.url(),
    weightBandLabel,
  });

  if (input.dryRun) {
    return {
      ok: true,
      dryRun: true,
      step: "before_publicar",
      externalUrl: null,
    };
  }

  throwIfPublishAborted();
  const published = await clickFinalPublish(page);
  log("info", "wallapop_publish_publicar_click", { published });
  if (!published) {
    throw new WallapopPublishError(
      "before_publicar",
      "No se pudo hacer click en Publicar.",
    );
  }

  const landingRead = await readLandingAfterPublicarClick(page);
  let reviewMessage: string | null = null;
  if (!landingRead.urlReadFailed) {
    reviewMessage = await wallapopUploadReviewMessage(page);
  }
  const landing = classifyPublishLanding({
    url: landingRead.url,
    urlReadFailed: landingRead.urlReadFailed,
    reviewMessage,
  });
  log(landing.ok ? "info" : "warn", "wallapop_publish_verify", {
    reason: landing.reason,
    url: landingRead.url,
  });
  if (!landing.ok) {
    const keepClaim =
      landing.reason === "target_closed" || landing.reason === "unexpected_url";
    throw new WallapopPublishError("form", landing.message, { keepClaim });
  }

  const externalUrl = landingRead.url
    ? listingUrlFromPageUrl(landingRead.url)
    : null;
  log("info", "wallapop_publish_done", {
    step: "published",
    reason: landing.reason,
    externalUrl,
  });
  return {
    ok: true,
    dryRun: false,
    step: "published",
    externalUrl,
  };
}
