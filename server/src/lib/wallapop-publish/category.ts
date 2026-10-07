import type { Page } from "playwright";

import { log } from "../log";
import { logPublishStep } from "./debug";
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

const CATEGORY_DROPDOWN_OPEN_EVAL = `(() => {
      const listbox = document.querySelector('[role="listbox"]');
      if (!listbox) return false;
      const r = listbox.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      return !!listbox.querySelector("walla-dropdown-item[role=option]");
    })()`;

const SCROLL_CATEGORY_EVAL = `(() => {
    const h1 = [...document.querySelectorAll("h1")].find((h) =>
      /Selecciona una categoría/i.test(h.innerText || ""),
    );
    h1?.scrollIntoView({ block: "center" });
  })()`;

const CLICK_CATEGORY_DROPDOWN_EVAL = `(() => {
    const dd = document.querySelector("walla-dropdown");
    if (dd) {
      const btn = dd.querySelector('[role="button"]') || dd;
      btn?.click?.();
      return true;
    }
    return false;
  })()`;

export async function categorySectionVisible(page: Page): Promise<boolean> {
  const body = (await page.evaluate(BODY_TEXT_EVAL)) as string;
  return PUBLISH_CATEGORY.sectionHeading.test(body);
}

export async function categoryPickerStillEmpty(page: Page): Promise<boolean> {
  return Boolean(await page.evaluate(CATEGORY_PICKER_EMPTY_JS));
}

async function categoryDropdownOpen(page: Page): Promise<boolean> {
  return Boolean(await page.evaluate(CATEGORY_DROPDOWN_OPEN_EVAL));
}

async function scrollCategorySectionIntoView(page: Page): Promise<void> {
  await page
    .getByText(PUBLISH_CATEGORY.sectionHeading)
    .first()
    .scrollIntoViewIfNeeded()
    .catch(() => {});
  await page.evaluate(SCROLL_CATEGORY_EVAL);
  await page.waitForTimeout(500);
}

async function clickCategoryDropdownHost(page: Page): Promise<boolean> {
  const dropdown = page.locator(PUBLISH_CATEGORY.dropdownTag).filter({
    hasText: PUBLISH_CATEGORY.triggerText,
  });
  if (!(await dropdown.first().isVisible().catch(() => false))) return false;
  await dropdown.first().click({ force: true });
  await page.waitForTimeout(900);
  if (await categoryDropdownOpen(page)) return true;
  const roleBtn = dropdown.first().locator('[role="button"]').first();
  if (!(await roleBtn.isVisible().catch(() => false))) return false;
  await roleBtn.click({ force: true });
  await page.waitForTimeout(900);
  return categoryDropdownOpen(page);
}

async function clickCategoryTriggerByRole(page: Page): Promise<boolean> {
  const byRole = page.getByRole("button", {
    name: PUBLISH_CATEGORY.triggerText,
    exact: true,
  });
  if (!(await byRole.first().isVisible().catch(() => false))) return false;
  await byRole.first().click({ force: true });
  await page.waitForTimeout(900);
  return categoryDropdownOpen(page);
}

async function openCategoryPicker(page: Page): Promise<void> {
  await scrollCategorySectionIntoView(page);
  if (await categoryDropdownOpen(page)) return;
  if (await clickCategoryDropdownHost(page)) return;
  if (await clickCategoryTriggerByRole(page)) return;
  await page.evaluate(CLICK_CATEGORY_DROPDOWN_EVAL);
  await page.waitForTimeout(900);
}

async function clickOptionByAria(page: Page, label: string): Promise<boolean> {
  const item = page
    .locator(
      `${PUBLISH_CATEGORY.optionTag}[role=option][aria-label="${label}"]`,
    )
    .first();
  if (!(await item.isVisible().catch(() => false))) return false;
  await item.click({ force: true });
  await page.waitForTimeout(1_000);
  return true;
}

async function clickOptionByRole(page: Page, label: string): Promise<boolean> {
  const byRole = page.getByRole("option", { name: label, exact: true });
  if (!(await byRole.first().isVisible().catch(() => false))) return false;
  await byRole.first().click({ force: true });
  await page.waitForTimeout(1_000);
  return true;
}

const CLICK_OPTION_EVAL = `((label) => {
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
  })`;

async function clickOptionViaEvaluate(
  page: Page,
  label: string,
): Promise<boolean> {
  const clicked = await page.evaluate(
    `${CLICK_OPTION_EVAL}(${JSON.stringify(label)})`,
  );
  if (!clicked) return false;
  await page.waitForTimeout(1_000);
  return true;
}

async function clickWallaDropdownOption(
  page: Page,
  label: string,
): Promise<boolean> {
  if (await clickOptionByAria(page, label)) return true;
  if (await clickOptionByRole(page, label)) return true;
  return clickOptionViaEvaluate(page, label);
}

async function clickCategoryOption(
  page: Page,
  label: string,
): Promise<boolean> {
  if (await clickWallaDropdownOption(page, label)) return true;
  return false;
}

async function categoryAlreadySet(page: Page, leaf: string): Promise<boolean> {
  const body = (await page.evaluate(BODY_TEXT_EVAL)) as string;
  return body.includes(leaf) && !(await categoryPickerStillEmpty(page));
}

async function selectCategoryLeafSuggested(
  page: Page,
  leaf: string,
): Promise<boolean> {
  if (!(await clickCategoryOption(page, leaf))) return false;
  await page.waitForTimeout(500);
  return !(await categoryPickerStillEmpty(page));
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
    const clicked = await clickCategoryOption(page, label);
    if (!clicked) {
      log("warn", "wallapop_publish_category_click_miss", { label });
    } else if (label === leaf && !(await categoryPickerStillEmpty(page))) {
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

function logCategoryDone(page: Page, leaf: string, via?: string): void {
  logPublishStep("form", page, {
    category: "select_done",
    leaf,
    ...(via ? { via } : {}),
  });
}

async function assertCategoryPicked(
  page: Page,
  labels: string[],
  leaf: string,
): Promise<void> {
  if (await categoryPickerStillEmpty(page)) {
    throw new WallapopPublishError(
      "form",
      `No se pudo seleccionar la categoría (${leaf}). Abre el desplegable en Chrome y comprueba las etiquetas.${categoryMissHint(labels)}`,
    );
  }
  logCategoryDone(page, leaf);
}

async function pickCategoryOnForm(
  page: Page,
  labels: string[],
  leaf: string,
): Promise<void> {
  logPublishStep("form", page, { category: "select_start", labels });
  await openCategoryPicker(page);
  logPublishStep("form", page, {
    category: "picker_open",
    open: await categoryDropdownOpen(page),
  });
  if (await selectCategoryLeafSuggested(page, leaf)) {
    logCategoryDone(page, leaf, "leaf_suggested");
    return;
  }
  if (await selectCategoryBreadcrumb(page, labels, leaf)) {
    logCategoryDone(page, leaf, "breadcrumb");
    return;
  }
  await assertCategoryPicked(page, labels, leaf);
}

export async function ensureCategorySelected(
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
  if (await categoryAlreadySet(page, leaf)) {
    logPublishStep("form", page, { category: "already_set", leaf });
    return;
  }
  await pickCategoryOnForm(page, labels, leaf);
}
