import type { Page } from "playwright";

import { log } from "../log";
import {
  HEAVY_WEIGHT_BANDS,
  STANDARD_WEIGHT_BANDS,
  isKnownWeightBand,
  normalizeCategoryWeightBands,
  normalizeWeightBandLabel,
  pickCategoryWeightBand,
  publishWeightStopMessage,
  wallapopStandardWeightBandFromCrm,
  type StandardWeightBandNeedle,
} from "../wallapop-weight-band";
import { snapshotPublishForm } from "./debug";
import { WallapopPublishError, type ShippingPackageType } from "./types";

const WEIGHT_HEADING_RE =
  /Cuánto pesa|How much (does it )?weigh|Скільки важить/i;

const FILL_WALLA_NATIVE_JS = `((sel, v) => {
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
    })`;

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
    await page.evaluate(
      `${FILL_WALLA_NATIVE_JS}(${JSON.stringify(selector)}, ${JSON.stringify(value)})`,
    ),
  );
}

export async function fillMeasuresIfPresent(
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
  log("info", "wallapop_publish_measures_filled", {
    widthCm,
    lengthCm,
    heightCm,
  });
}

/**
 * Stencil `walla-radio` hydrates the `<input>` in light DOM (`aria-label`).
 * `value` is the option payload (`false` = Estándar, `true` = Voluminoso), not
 * checked state — only Playwright `isChecked()` / `HTMLInputElement.checked`.
 * `exact: true` so a longer accessible name cannot match `delivery`.
 */
async function clickRoleRadio(page: Page, name: string): Promise<void> {
  const radio = page.getByRole("radio", { name, exact: true }).first();
  await radio.waitFor({ state: "visible", timeout: 8_000 });
  await radio.scrollIntoViewIfNeeded();
  await radio.click({ timeout: 5_000 });
}

export async function roleRadioIsChecked(
  page: Page,
  name: string,
): Promise<boolean> {
  const radio = page.getByRole("radio", { name, exact: true }).first();
  if (!(await radio.count().catch(() => 0))) return false;
  return Boolean(await radio.isChecked().catch(() => false));
}

async function roleRadioIsVisible(page: Page, name: string): Promise<boolean> {
  const radio = page.getByRole("radio", { name, exact: true }).first();
  if (!(await radio.count().catch(() => 0))) return false;
  return Boolean(await radio.isVisible().catch(() => false));
}

const PACKAGE_SIZE_AFTER_HEAVY_MS = 8_000;

const READ_VISIBLE_WEIGHT_LABELS_JS = `(() => {
  const bidi = /[\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]/g;
  const norm = (value) => (value || "").replace(bidi, "").replace(/\\s+/g, " ").trim();
  const nodes = document.querySelectorAll("#weightTierLabel, label span");
  const out = [];
  for (const el of nodes) {
    const text = norm(el.textContent);
    if (text) out.push(text);
  }
  return out;
})()`;

const CLICK_VISIBLE_WEIGHT_BAND_JS = `((needle) => {
  const bidi = /[\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]/g;
  const norm = (value) => (value || "").replace(bidi, "").replace(/\\s+/g, " ").trim();
  const nodes = [...document.querySelectorAll("#weightTierLabel, label span")];
  const label = nodes.find((el) => norm(el.textContent) === needle);
  if (!label) return false;
  const row = label.closest(".DeliveryRadioOption") || label.closest("label") || label.parentElement;
  const input = row && row.querySelector("input[type=radio]");
  const target = input || label;
  target.scrollIntoView({ block: "center" });
  target.click();
  return true;
})`;

const WEIGHT_BAND_CHECKED_JS = `((needle) => {
  const bidi = /[\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]/g;
  const norm = (value) => (value || "").replace(bidi, "").replace(/\\s+/g, " ").trim();
  const nodes = [...document.querySelectorAll("#weightTierLabel, label span")];
  const label = nodes.find((el) => norm(el.textContent) === needle);
  if (!label) return false;
  const row = label.closest(".DeliveryRadioOption") || label.closest("label") || label.parentElement;
  const input = row && row.querySelector("input[type=radio]");
  return !!(input && input.checked);
})`;

async function visibleWeightBandNeedles(
  page: Page,
): Promise<StandardWeightBandNeedle[]> {
  const raw = (await page.evaluate(READ_VISIBLE_WEIGHT_LABELS_JS).catch(() => [])) as unknown;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const visible: StandardWeightBandNeedle[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const needle = normalizeWeightBandLabel(item);
    if (!isKnownWeightBand(needle) || seen.has(needle)) continue;
    seen.add(needle);
    visible.push(needle);
  }
  return STANDARD_WEIGHT_BANDS.map((band) => band.needle).filter((needle) =>
    seen.has(needle),
  );
}

async function weightUiVisible(page: Page): Promise<boolean> {
  return (
    (await page
      .getByText(WEIGHT_HEADING_RE)
      .first()
      .isVisible()
      .catch(() => false)) || (await visibleWeightBandNeedles(page)).length > 0
  );
}

function bandsThisCategoryAllows(
  visible: readonly StandardWeightBandNeedle[],
  categoryBands: readonly string[] | null | undefined,
): StandardWeightBandNeedle[] {
  const mapped = normalizeCategoryWeightBands(categoryBands);
  if (mapped.length === 0) return [...visible];
  const allowed = new Set(mapped);
  return visible.filter((needle) => allowed.has(needle));
}

async function clickPackageSizeUntilChecked(
  page: Page,
  which: string,
): Promise<boolean> {
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
      return true;
    }
  }
  return false;
}

/**
 * Some categories (jardín / bulky) show Estándar vs Voluminoso first;
 * «¿Cuánto pesa?» only after Estándar. Other categories already show kg bands
 * with no size radios — do not click anything then (`ensureEnvioToggle` already set envío).
 */
export async function ensurePackageSizeIfShown(
  page: Page,
  packageType: ShippingPackageType,
): Promise<void> {
  const sizeShown =
    (await roleRadioIsVisible(page, "delivery")) ||
    (await roleRadioIsVisible(page, "bulky"));
  const weightShown = await weightUiVisible(page);
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
  if (await clickPackageSizeUntilChecked(page, which)) return;
  log("warn", "wallapop_publish_package_size_unselected", {
    which,
    ...(await snapshotPublishForm(page)),
    url: page.url(),
  });
}

async function clickVisibleWeightBand(
  page: Page,
  labelNeedle: string,
): Promise<void> {
  const clicked = await page.evaluate(
    `${CLICK_VISIBLE_WEIGHT_BAND_JS}(${JSON.stringify(labelNeedle)})`,
  );
  if (!clicked) {
    throw new WallapopPublishError(
      "form",
      `No se ve el tramo de peso (${labelNeedle}).`,
    );
  }
}

export async function isStandardWeightBandSelected(
  page: Page,
  labelNeedle: string,
): Promise<boolean> {
  return Boolean(
    await page
      .evaluate(`${WEIGHT_BAND_CHECKED_JS}(${JSON.stringify(labelNeedle)})`)
      .catch(() => false),
  );
}

async function waitForVisibleWeightBands(
  page: Page,
  weightKg: number,
): Promise<StandardWeightBandNeedle[]> {
  const deadline = Date.now() + 8_000;
  let visible: StandardWeightBandNeedle[] = [];
  while (Date.now() < deadline) {
    visible = await visibleWeightBandNeedles(page);
    if (visible.length > 0) return visible;
    await page.waitForTimeout(200);
  }
  log("warn", "wallapop_publish_weight_selector_missing", {
    weightKg,
    reason: "no_visible_weight_band_label",
    ...(await snapshotPublishForm(page)),
    url: page.url(),
  });
  return visible;
}

async function packageSizeVisible(page: Page): Promise<boolean> {
  return (
    (await roleRadioIsVisible(page, "delivery")) ||
    (await roleRadioIsVisible(page, "bulky"))
  );
}

async function waitForPackageSizeAfterHeavyBand(page: Page): Promise<boolean> {
  const deadline = Date.now() + PACKAGE_SIZE_AFTER_HEAVY_MS;
  while (Date.now() < deadline) {
    if (await packageSizeVisible(page)) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

async function clickWeightBandUntilSelected(
  page: Page,
  labelNeedle: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await clickVisibleWeightBand(page, labelNeedle);
    } catch (err) {
      log("warn", "wallapop_publish_weight_band_click_fail", {
        labelNeedle,
        attempt,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    await page.waitForTimeout(700);
    if (await isStandardWeightBandSelected(page, labelNeedle)) {
      log("info", "wallapop_publish_weight_selected", { labelNeedle, attempt });
      return true;
    }
  }
  return false;
}

async function requirePackageSizeAfterHeavyBand(
  page: Page,
  weightKg: number,
  picked: { needle: string; wanted: string | null },
): Promise<void> {
  if (!HEAVY_WEIGHT_BANDS.has(picked.needle)) return;
  if (await waitForPackageSizeAfterHeavyBand(page)) return;
  log("error", "wallapop_publish_package_size_missing_after_weight", {
    weightKg,
    labelNeedle: picked.needle,
    wanted: picked.wanted,
    ...(await snapshotPublishForm(page)),
    url: page.url(),
  });
  throw new WallapopPublishError(
    "form",
    publishWeightStopMessage({
      wanted: picked.wanted,
      selected: picked.needle,
      reason: "no_package_size",
    }),
    { keepBrowser: true },
  );
}

export async function ensureStandardWeightBand(
  page: Page,
  weightKg: number,
  categoryBands?: readonly string[] | null,
): Promise<string | null> {
  const visible = await waitForVisibleWeightBands(page, weightKg);
  if (visible.length === 0) return null;
  const allowed = bandsThisCategoryAllows(visible, categoryBands);
  const picked = pickCategoryWeightBand(weightKg, allowed);
  if (!picked) {
    const wanted = wallapopStandardWeightBandFromCrm(weightKg);
    throw new WallapopPublishError(
      "form",
      publishWeightStopMessage({
        wanted,
        selected: null,
        reason: "no_bands",
      }),
      { failListing: true },
    );
  }
  log("info", "wallapop_publish_weight_try", {
    weightKg,
    labelNeedle: picked.needle,
    wanted: picked.wanted,
    clamped: picked.clamped,
    visible,
    categoryBands: normalizeCategoryWeightBands(categoryBands),
  });
  if (await isStandardWeightBandSelected(page, picked.needle)) {
    log("info", "wallapop_publish_weight_already_selected", {
      labelNeedle: picked.needle,
    });
  } else if (!(await clickWeightBandUntilSelected(page, picked.needle))) {
    log("error", "wallapop_publish_weight_select_exhausted", {
      weightKg,
      labelNeedle: picked.needle,
      ...(await snapshotPublishForm(page)),
      url: page.url(),
    });
    throw new WallapopPublishError(
      "form",
      `No se pudo seleccionar el tramo de peso (${picked.needle}).`,
    );
  }
  await requirePackageSizeAfterHeavyBand(page, weightKg, picked);
  return picked.needle;
}

export async function assertShippingReadyForPublish(
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

