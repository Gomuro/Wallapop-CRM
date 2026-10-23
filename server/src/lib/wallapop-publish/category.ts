import type { Page } from "playwright";

import { log } from "../log";
import { logPublishStep } from "./debug";
import {
  categoryDropdownOpen,
  clickCategoryOption,
  normalizeCategoryLabel,
  openCategoryPicker,
  optionListHasLabel,
  readCategoryMenu,
} from "./category-menu";
import { PUBLISH_CATEGORY, WallapopPublishError } from "./types";

const BODY_TEXT_EVAL = `document.body ? document.body.innerText : ""`;

const CATEGORY_PICKER_EMPTY_JS = `(() => {
      const body = document.body ? document.body.innerText : "";
      if (!/Selecciona una categoría/i.test(body)) return false;
      const trigger = ${JSON.stringify(PUBLISH_CATEGORY.triggerText)};
      const idx = body.indexOf(trigger);
      if (idx === -1) return false;
      const after = body.slice(idx, idx + 200);
      if (after.trim() === trigger) return true;
      if (after.startsWith(trigger + "\\n") && after.length < trigger.length + 40) return true;
      return false;
    })()`;

export async function categorySectionVisible(page: Page): Promise<boolean> {
  const body = (await page.evaluate(BODY_TEXT_EVAL)) as string;
  return PUBLISH_CATEGORY.sectionHeading.test(body);
}

export async function categoryPickerStillEmpty(page: Page): Promise<boolean> {
  return Boolean(await page.evaluate(CATEGORY_PICKER_EMPTY_JS));
}

function controlHasLeaf(control: string, leaf: string): boolean {
  const wanted = normalizeCategoryLabel(leaf);
  return Boolean(wanted) && normalizeCategoryLabel(control).includes(wanted);
}

/**
 * The closed control names exactly this leaf: "Categoría y subcategoría, Accesorios Hogar y jardín > …".
 * The path after the leaf starts with a capital; a longer leaf name goes on in lower case
 * ("Herramientas eléctricas"), so it is not taken for "Herramientas".
 */
export function controlShowsLeaf(control: string, leaf: string): boolean {
  const wanted = normalizeCategoryLabel(leaf);
  const text = normalizeCategoryLabel(control);
  const trigger = PUBLISH_CATEGORY.triggerText;
  if (!wanted || !text.startsWith(trigger)) return false;
  const shown = text.slice(trigger.length).replace(/^,\s*/, "");
  if (!shown.startsWith(wanted)) return false;
  const rest = shown.slice(wanted.length);
  return rest === "" || /^ \p{Lu}/u.test(rest);
}

async function categoryAlreadySet(page: Page, leaf: string): Promise<boolean> {
  const menu = await readCategoryMenu(page);
  return controlHasLeaf(menu.control, leaf) && !(await categoryPickerStillEmpty(page));
}

/** One click only when this list already shows that exact leaf. Do not scroll the roots looking for it. */
async function selectCategoryLeafSuggested(
  page: Page,
  leaf: string,
): Promise<boolean> {
  const menu = await readCategoryMenu(page);
  if (!optionListHasLabel(menu.options, leaf)) return false;
  return clickCategoryOption(page, leaf, leaf);
}

async function selectCategoryBreadcrumb(
  page: Page,
  labels: string[],
  leaf: string,
): Promise<boolean> {
  for (const label of labels) {
    if (!(await categoryDropdownOpen(page))) {
      await openCategoryPicker(page);
    }
    const clicked = await clickCategoryOption(page, label, leaf);
    const menu = await readCategoryMenu(page);
    if (!clicked) {
      log("warn", "wallapop_publish_category_click_miss", {
        label,
        leafId: menu.leafId,
        control: menu.control,
        options: menu.options,
      });
      return false;
    }
    log("info", "wallapop_publish_category_click", {
      label,
      leafId: menu.leafId,
      options: menu.options,
    });
    if (normalizeCategoryLabel(label) === normalizeCategoryLabel(leaf)) {
      return true;
    }
    await page.waitForTimeout(400);
  }
  return false;
}

function categoryMissHint(labels: string[]): string {
  if (labels.length === 1 && /coches|motos|inmobiliaria/i.test(labels[0] ?? "")) {
    return " Elige una categoría de consumer goods en el CRM (p. ej. Electrodomésticos).";
  }
  return "";
}

async function logCategoryDone(page: Page, leaf: string, via?: string): Promise<void> {
  const menu = await readCategoryMenu(page);
  logPublishStep("form", page, {
    category: "select_done",
    leaf,
    leafId: menu.leafId,
    control: menu.control,
    ...(via ? { via } : {}),
  });
}

/**
 * Every path ends here: the closed control must name the CRM leaf. A new hidden leaf id is not
 * proof. On the VPS (2026-10-23) a stray click left Motos for Accesorios and it was published.
 */
async function assertCategoryPicked(
  page: Page,
  labels: string[],
  leaf: string,
  via?: string,
): Promise<void> {
  const menu = await readCategoryMenu(page);
  if (!controlShowsLeaf(menu.control, leaf)) {
    log("warn", "wallapop_publish_category_leaf_mismatch", {
      expected: leaf,
      shown: menu.control,
      leafId: menu.leafId,
      ...(via ? { via } : {}),
    });
    const shown = menu.control || menu.leafId || "vacía";
    throw new WallapopPublishError(
      "form",
      `No se pudo seleccionar la categoría (${leaf}). Wallapop dejó «${shown}».${categoryMissHint(labels)}`,
    );
  }
  await logCategoryDone(page, leaf, via);
}

async function pickCategoryOnForm(
  page: Page,
  labels: string[],
  leaf: string,
): Promise<void> {
  logPublishStep("form", page, { category: "select_start", labels });
  await openCategoryPicker(page);
  const opened = await readCategoryMenu(page);
  if (opened.leafId && !controlHasLeaf(opened.control, leaf)) {
    log("info", "wallapop_publish_category_suggestion", {
      leafId: opened.leafId,
      control: opened.control,
      replaceWith: leaf,
    });
  }
  logPublishStep("form", page, {
    category: "picker_open",
    open: await categoryDropdownOpen(page),
    leafId: opened.leafId,
    control: opened.control,
  });
  // A longer path is walked from the root. The pinned suggestion stays unless it is our only label.
  if (labels.length === 1 && (await selectCategoryLeafSuggested(page, leaf))) {
    await assertCategoryPicked(page, labels, leaf, "leaf_suggested");
    return;
  }
  const walked = await selectCategoryBreadcrumb(page, labels, leaf);
  await assertCategoryPicked(page, labels, leaf, walked ? "breadcrumb" : undefined);
}

export async function ensureCategorySelected(
  page: Page,
  labels: string[],
): Promise<void> {
  const normalized = labels.map(normalizeCategoryLabel).filter(Boolean);
  if (!normalized.length) {
    throw new WallapopPublishError(
      "form",
      "Faltan etiquetas de categoría para Wallapop.",
    );
  }
  const leaf = normalized[normalized.length - 1]!;
  if (await categoryAlreadySet(page, leaf)) {
    logPublishStep("form", page, { category: "already_set", leaf });
    return;
  }
  await pickCategoryOnForm(page, normalized, leaf);
}
