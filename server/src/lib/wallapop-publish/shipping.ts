import type { Page } from "playwright";

import { log } from "../log";
import { snapshotPublishForm } from "./debug";
import { clickRoleRadio, roleRadioIsChecked, roleRadioIsVisible } from "./radios";
import { WallapopPublishError, type ShippingPackageType } from "./types";
import { hasVisibleWeightBands, isStandardWeightBandSelected } from "./weight";

export { ensureStandardWeightBand, isStandardWeightBandSelected } from "./weight";
export { roleRadioIsChecked } from "./radios";

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

async function weightUiVisible(page: Page): Promise<boolean> {
  return (
    (await page
      .getByText(WEIGHT_HEADING_RE)
      .first()
      .isVisible()
      .catch(() => false)) || (await hasVisibleWeightBands(page))
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

const PACKAGE_UI_WAIT_MS = 15_000;
const PACKAGE_UI_POLL_MS = 500;

async function packageSizeShown(page: Page): Promise<boolean> {
  return (
    (await roleRadioIsVisible(page, "delivery")) ||
    (await roleRadioIsVisible(page, "bulky"))
  );
}

/**
 * Non-Pro forms draw Estándar / Voluminoso seconds after the category;
 * Pro shows the kg bands at once. Wait for either, up to `PACKAGE_UI_WAIT_MS`.
 */
async function waitForPackageOrWeightUi(page: Page): Promise<{
  sizeShown: boolean;
  weightShown: boolean;
  waitedMs: number;
}> {
  for (let waitedMs = 0; ; waitedMs += PACKAGE_UI_POLL_MS) {
    const sizeShown = await packageSizeShown(page);
    const weightShown = await weightUiVisible(page);
    if (sizeShown || weightShown || waitedMs >= PACKAGE_UI_WAIT_MS) {
      return { sizeShown, weightShown, waitedMs };
    }
    await page.waitForTimeout(PACKAGE_UI_POLL_MS);
  }
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
  const { sizeShown, weightShown, waitedMs } =
    await waitForPackageOrWeightUi(page);
  if (!sizeShown) {
    log("info", "wallapop_publish_package_size_absent", {
      packageType,
      weightShown,
      waitedMs,
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

