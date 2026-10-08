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

const OPEN_FIELD_JS = `((id, label) => {
  const byTest = document.querySelector('walla-dropdown[data-testid="' + id + '"]');
  const host =
    byTest ||
    (() => {
      const labels = [...document.querySelectorAll("label, .walla-text-input__label")];
      const lab = labels.find((el) =>
        (el.textContent || "").replace(/\\s+/g, " ").includes(label),
      );
      return (
        lab?.closest("walla-dropdown, tsl-upload-form-dropdown, tsl-upload-form-field-host") ||
        null
      );
    })();
  if (!host) return false;
  const btn =
    host.querySelector?.('[role="button"]') ||
    host.querySelector?.("walla-dropdown [role=button]");
  const target = btn || host;
  target.scrollIntoView?.({ block: "center" });
  target.click?.();
  return true;
})`;

const CLICK_TITLES_JS = `((titles) => {
  const norm = (s) =>
    (s || "").replace(/\\s+/g, " ").trim().toLowerCase();
  const wanted = titles.map(norm);
  const items = [
    ...document.querySelectorAll(
      'walla-dropdown-item[role="option"], [role="listbox"] [role="option"]',
    ),
  ];
  let n = 0;
  for (const el of items) {
    const aria = norm(el.getAttribute("aria-label"));
    const body = norm(el.textContent);
    if (!wanted.some((w) => aria === w || body === w || aria.includes(w) || body.includes(w))) {
      continue;
    }
    const box = el.querySelector("input[type=checkbox]");
    if (box && !box.checked) box.click();
    else el.click();
    n += 1;
  }
  const apply = [...document.querySelectorAll("walla-button, button")].find((el) =>
    /aplicar|confirmar|guardar|ok/i.test(el.innerText || el.getAttribute("text") || ""),
  );
  if (apply) (apply.shadowRoot?.querySelector("button") || apply).click();
  return n;
})`;

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
    await page.waitForTimeout(400);
    const clicked = opened
      ? ((await page.evaluate(
          `${CLICK_TITLES_JS}(${JSON.stringify(titles)})`,
        )) as number)
      : 0;
    await closeOpenDropdowns(page);
    log("info", "wallapop_publish_extra_field", {
      id: field.id,
      opened,
      clicked,
      titles,
    });
    if (field.required && clicked < 1) {
      throw new WallapopPublishError(
        "form",
        `No se pudo seleccionar ${field.label} en Wallapop.`,
      );
    }
  }
}
