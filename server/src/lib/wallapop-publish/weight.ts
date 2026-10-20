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
import { roleRadioIsVisible } from "./radios";
import { WallapopPublishError } from "./types";
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

export async function hasVisibleWeightBands(page: Page): Promise<boolean> {
  return (await visibleWeightBandNeedles(page)).length > 0;
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

function rejectMissingWeightBand(weightKg: number): never {
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

async function selectWeightBand(
  page: Page,
  picked: { needle: string; wanted: string | null; clamped: boolean },
  detail: {
    weightKg: number;
    visible: readonly StandardWeightBandNeedle[];
    categoryBands?: readonly string[] | null;
  },
): Promise<void> {
  log("info", "wallapop_publish_weight_try", {
    weightKg: detail.weightKg,
    labelNeedle: picked.needle,
    wanted: picked.wanted,
    clamped: picked.clamped,
    visible: detail.visible,
    categoryBands: normalizeCategoryWeightBands(detail.categoryBands),
  });
  if (await isStandardWeightBandSelected(page, picked.needle)) {
    log("info", "wallapop_publish_weight_already_selected", {
      labelNeedle: picked.needle,
    });
    return;
  }
  if (await clickWeightBandUntilSelected(page, picked.needle)) return;
  log("error", "wallapop_publish_weight_select_exhausted", {
    weightKg: detail.weightKg,
    labelNeedle: picked.needle,
    ...(await snapshotPublishForm(page)),
    url: page.url(),
  });
  throw new WallapopPublishError(
    "form",
    `No se pudo seleccionar el tramo de peso (${picked.needle}).`,
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
  if (!picked) rejectMissingWeightBand(weightKg);
  await selectWeightBand(page, picked, { weightKg, visible, categoryBands });
  await requirePackageSizeAfterHeavyBand(page, weightKg, picked);
  return picked.needle;
}

