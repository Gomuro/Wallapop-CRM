import type { Page } from "playwright";

import { log } from "../log";
import { logPublishStep } from "./debug";
import {
  categoryDropdownOpen,
  clickCategoryOption,
  normalizeCategoryLabel,
  openCategoryPicker,
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

async function categoryAlreadySet(page: Page, leaf: string): Promise<boolean> {
  const menu = await readCategoryMenu(page);
  return controlHasLeaf(menu.control, leaf) && !(await categoryPickerStillEmpty(page));
}

async function selectCategoryLeafSuggested(
  page: Page,
  leaf: string,
): Promise<boolean> {
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
    if (!clicked) {
      const menu = await readCategoryMenu(page);
      log("warn", "wallapop_publish_category_click_miss", {
        label,
        leafId: menu.leafId,
        control: menu.control,
        options: menu.options,
      });
    } else if (normalizeCategoryLabel(label) === normalizeCategoryLabel(leaf)) {
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

async function assertCategoryPicked(
  page: Page,
  labels: string[],
  leaf: string,
  openedLeafId: string,
): Promise<void> {
  const menu = await readCategoryMenu(page);
  const wanted = normalizeCategoryLabel(leaf);
  const menuClosedOnNewLeaf =
    Boolean(menu.leafId) &&
    menu.leafId !== openedLeafId &&
    !menu.options.some((row) => normalizeCategoryLabel(row) === wanted);
  const chosen = controlHasLeaf(menu.control, leaf) || menuClosedOnNewLeaf;
  if (!chosen) {
    const shown = menu.control || menu.leafId || "vacía";
    throw new WallapopPublishError(
      "form",
      `No se pudo seleccionar la categoría (${leaf}). Wallapop dejó «${shown}».${categoryMissHint(labels)}`,
    );
  }
  await logCategoryDone(page, leaf);
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
  if (await selectCategoryLeafSuggested(page, leaf)) {
    await logCategoryDone(page, leaf, "leaf_suggested");
    return;
  }
  if (await selectCategoryBreadcrumb(page, labels, leaf)) {
    await logCategoryDone(page, leaf, "breadcrumb");
    return;
  }
  await assertCategoryPicked(page, labels, leaf, opened.leafId);
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
