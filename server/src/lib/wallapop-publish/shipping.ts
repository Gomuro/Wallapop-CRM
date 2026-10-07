import type { Page } from "playwright";

import { log } from "../log";
import {
  wallapopStandardWeightBandAriaName,
  wallapopStandardWeightBandFromCrm,
} from "../wallapop-weight-band";
import { snapshotPublishForm } from "./debug";
import { clickMainText } from "./nav";
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
 * `exact: true` is required: kg radios are named "Delivery Option N" and would
 * otherwise substring-match `name: "delivery"`.
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

async function weightUiVisible(page: Page): Promise<boolean> {
  return (
    (await page
      .getByText(WEIGHT_HEADING_RE)
      .first()
      .isVisible()
      .catch(() => false)) ||
    (await roleRadioIsVisible(page, "Delivery Option 0"))
  );
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
 * with no size radios — do not click anything then (Activar envío stays as Wallapop set it).
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

export async function isStandardWeightBandSelected(
  page: Page,
  labelNeedle: string,
): Promise<boolean> {
  const ariaName = wallapopStandardWeightBandAriaName(labelNeedle);
  if (!ariaName) return false;
  return roleRadioIsChecked(page, ariaName);
}

async function waitForWeightBandUi(
  page: Page,
  weightKg: number,
  labelNeedle: string,
): Promise<boolean> {
  try {
    await page
      .getByText(WEIGHT_HEADING_RE)
      .first()
      .waitFor({ state: "visible", timeout: 8_000 });
    await page
      .getByRole("radio", { name: "Delivery Option 0", exact: true })
      .first()
      .waitFor({ state: "visible", timeout: 5_000 });
    return true;
  } catch (error) {
    log("warn", "wallapop_publish_weight_selector_missing", {
      weightKg,
      labelNeedle,
      reason: "cuanto_pesa_or_delivery_option_0_not_visible",
      waitMessage: error instanceof Error ? error.message : String(error),
      ...(await snapshotPublishForm(page)),
      url: page.url(),
    });
    return false;
  }
}

async function clickWeightBandUntilSelected(
  page: Page,
  labelNeedle: string,
): Promise<boolean> {
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
      log("info", "wallapop_publish_weight_selected", { labelNeedle, attempt });
      return true;
    }
  }
  return false;
}

export async function ensureStandardWeightBand(
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
  if (!(await waitForWeightBandUi(page, weightKg, labelNeedle))) return null;
  if (await isStandardWeightBandSelected(page, labelNeedle)) {
    log("info", "wallapop_publish_weight_already_selected", { labelNeedle });
    return labelNeedle;
  }
  if (await clickWeightBandUntilSelected(page, labelNeedle)) return labelNeedle;
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

const BODY_TEXT_EVAL = `document.body ? document.body.innerText : ""`;

export async function ensureMaterialOtro(page: Page): Promise<void> {
  const body = (await page.evaluate(BODY_TEXT_EVAL)) as string;
  if (/Material/i.test(body) && !/Otro|Madera|Metal|Plástico/i.test(body)) {
    await clickMainText(page, "Material");
    await page.waitForTimeout(300);
    await clickMainText(page, "Otro");
  }
}
