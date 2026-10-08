import type { Page } from "playwright";

import type { CategoryUploadField } from "../../../../lib/inventory/category-upload-fields";
import {
  extraUploadFields,
  selectedIdsForField,
} from "../../../../lib/inventory/category-upload-fields";
import { log } from "../log";
import { WallapopPublishError } from "./types";
import { closeOpenDropdowns } from "./dropdown";

function titlesForIds(
  field: CategoryUploadField,
  ids: string[],
): string[] {
  return ids.map((id) => {
    const option = field.options.find((row) => row.id === id);
    return option?.title ?? id;
  });
}

const FIND_HOST_JS = `(function findHost(id, label) {
  const byTest = document.querySelector('walla-dropdown[data-testid="' + id + '"]');
  if (byTest) return byTest;
  const labels = [...document.querySelectorAll("label, .walla-text-input__label")];
  const lab = labels.find((el) =>
    (el.textContent || "").replace(/\\s+/g, " ").includes(label),
  );
  return (
    lab?.closest("walla-dropdown, tsl-upload-form-dropdown, tsl-upload-form-field-host") ||
    null
  );
})`;

const OPEN_FIELD_JS = `((id, label) => {
  const host = ${FIND_HOST_JS}(id, label);
  if (!host) return false;
  const btn =
    host.querySelector('[role="button"]') ||
    host.querySelector("walla-dropdown [role=button]");
  const target = btn || host;
  target.scrollIntoView({ block: "center" });
  target.click();
  return true;
})`;

function openPanel(page: Page) {
  return page
    .locator(".walla-dropdown__floating-area")
    .filter({ has: page.locator('walla-dropdown-item[role="option"]') })
    .filter({ visible: true })
    .last();
}

/** Click the visible option row. Slotted 0×0 copies do not receive the click. */
async function clickFieldOptions(
  page: Page,
  titles: string[],
  optionIds: string[],
): Promise<number> {
  const panel = openPanel(page);
  await panel.waitFor({ state: "visible", timeout: 5_000 });
  const clear = panel.getByRole("button", { name: /^(Borrar|Limpiar)$/i });
  if ((await clear.count()) > 0) {
    await clear.first().click({ force: true });
    await page.waitForTimeout(250);
  }
  let n = 0;
  for (let i = 0; i < optionIds.length; i++) {
    const id = optionIds[i];
    const title = titles[i] ?? id;
    const byBox = panel
      .locator(`walla-dropdown-item[role="option"]:has(input#${id})`)
      .filter({ visible: true });
    const byAria = panel
      .getByRole("option", { name: title, exact: true })
      .filter({ visible: true });
    const item = (await byBox.count()) > 0 ? byBox.first() : byAria.first();
    if ((await item.count()) < 1) continue;
    await item.scrollIntoViewIfNeeded();
    await item.click({ force: true });
    n += 1;
    await page.waitForTimeout(150);
  }
  const sticky = panel.locator(".walla-dropdown__sticky-button walla-button");
  if ((await sticky.count()) > 0) {
    await sticky.first().click({ force: true });
  } else {
    const confirm = panel.getByRole("button", {
      name: /^(Seleccionar|Aplicar)$/i,
    });
    if ((await confirm.count()) > 0) {
      await confirm.first().click({ force: true });
    }
  }
  await page.waitForTimeout(400);
  return n;
}

export async function ensureExtraUploadFields(
  page: Page,
  fields: CategoryUploadField[],
  typeAttributes: unknown,
): Promise<void> {
  const extra = extraUploadFields(fields);
  for (const field of extra) {
    const ids = selectedIdsForField(typeAttributes, field.id);
    if (field.required && ids.length < Math.max(1, field.min)) {
      throw new WallapopPublishError(
        "form",
        `Falta ${field.label} en el producto. Wallapop no deja publicar sin este campo.`,
      );
    }
    if (ids.length === 0) continue;
    if (field.id === "brand" || field.type === "combo_box") continue;
    const titles = titlesForIds(field, ids);
    await closeOpenDropdowns(page);
    const opened = (await page.evaluate(
      `${OPEN_FIELD_JS}(${JSON.stringify(field.id)}, ${JSON.stringify(field.label)})`,
    )) as boolean;
    let clicked = 0;
    if (opened) {
      try {
        clicked = await clickFieldOptions(page, titles, ids);
      } catch {
        clicked = 0;
      }
    }
    await closeOpenDropdowns(page);
    log("info", "wallapop_publish_extra_field", {
      id: field.id,
      opened,
      clicked,
      titles,
      ids,
    });
    if (field.required && clicked < 1) {
      throw new WallapopPublishError(
        "form",
        `No se pudo seleccionar ${field.label} en Wallapop.`,
      );
    }
  }
}
