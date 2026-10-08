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

const WALK_JS = `function walk(node, acc) {
  if (!node) return acc;
  if (node.querySelectorAll) {
    for (const el of node.querySelectorAll("*")) {
      acc.push(el);
      if (el.shadowRoot) walk(el.shadowRoot, acc);
    }
  }
  return acc;
}`;

const OPEN_FIELD_JS = `((id, label) => {
  ${WALK_JS}
  const host = ${FIND_HOST_JS}(id, label);
  if (!host) return false;
  const btn = walk(host, []).find(
    (el) => el.getAttribute && el.getAttribute("role") === "button",
  );
  const target = btn || host;
  target.scrollIntoView?.({ block: "center" });
  target.click?.();
  return true;
})`;

/** Portaled list + checkbox id + sticky confirm (label varies). Borrar clears leftover Metal. */
const CLICK_TITLES_IN_HOST_JS = `((id, label, titles, optionIds) => {
  ${WALK_JS}
  const norm = (s) =>
    (s || "").replace(/\\s+/g, " ").trim().toLowerCase();
  const wanted = titles.map(norm);
  const ids = optionIds.map(norm);
  const host = ${FIND_HOST_JS}(id, label);
  if (!host) return 0;
  const expanded = walk(host, []).find(
    (el) => el.getAttribute && el.getAttribute("aria-expanded") === "true",
  );
  const listId = expanded?.getAttribute("aria-controls");
  const floating = [...document.querySelectorAll(".walla-dropdown__floating-area")].find(
    (el) => el.getBoundingClientRect().height > 40,
  );
  const list = (listId && document.getElementById(listId)) || floating || host;
  const clear = [...list.querySelectorAll("walla-button")].find((el) => {
    const t =
      el.shadowRoot?.querySelector("[part=button-text]")?.textContent ||
      el.innerText ||
      "";
    return /borrar|limpiar/i.test(t);
  });
  if (clear) (clear.shadowRoot?.querySelector("button") || clear).click();
  const items = [
    ...list.querySelectorAll(
      'walla-dropdown-item[role="option"], [role="listbox"] [role="option"]',
    ),
  ];
  let n = 0;
  for (const el of items) {
    const box = el.querySelector("input[type=checkbox], input[type=radio]");
    const boxId = norm(box?.id || box?.getAttribute("name"));
    const aria = norm(el.getAttribute("aria-label"));
    const hit =
      ids.some((oid) => boxId === oid) || wanted.some((w) => aria === w);
    if (!hit) continue;
    if (box && !box.checked) box.click();
    else el.click();
    n += 1;
  }
  const sticky = list.querySelector(
    ".walla-dropdown__sticky-button walla-button, .walla-dropdown__sticky-button button",
  );
  if (sticky) (sticky.shadowRoot?.querySelector("button") || sticky).click();
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
          `${CLICK_TITLES_IN_HOST_JS}(${JSON.stringify(field.id)}, ${JSON.stringify(field.label)}, ${JSON.stringify(titles)}, ${JSON.stringify(ids)})`,
        )) as number)
      : 0;
    await page.waitForTimeout(400);
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
