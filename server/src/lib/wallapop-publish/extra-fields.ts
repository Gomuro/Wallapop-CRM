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

const HOST_PRESENT_JS = `((id, label) => Boolean(${FIND_HOST_JS}(id, label)))`;

/** Category extras (Color) mount after the leaf is chosen. */
const COLOR_HOST_WAIT_MS = 4_000;
const COLOR_HOST_POLL_MS = 250;

function openPanel(page: Page) {
  return page
    .locator(".walla-dropdown__floating-area")
    .filter({ has: page.locator('walla-dropdown-item[role="option"]') })
    .filter({ visible: true })
    .last();
}

const VISIBLE_PANEL_FN = `function visibleFieldPanel() {
  return [...document.querySelectorAll(".walla-dropdown__floating-area")]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 8 && r.height > 8;
    })
    .at(-1) || null;
}`;

const FIND_OPTION_FN = `function findFieldOption(title, id) {
  ${VISIBLE_PANEL_FN}
  const panel = visibleFieldPanel();
  if (!panel) return null;
  const wanted = (title || "").replace(/\\s+/g, " ").trim().toLowerCase();
  return [...panel.querySelectorAll('walla-dropdown-item[role="option"]')].find((item) => {
    const aria = (item.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim().toLowerCase();
    const input = item.querySelector("input");
    return aria === wanted || input?.id === id || input?.name === id;
  }) || null;
}`;

async function clickPanelButton(page: Page, names: string[]): Promise<boolean> {
  return (await page.evaluate(`(() => {
    ${VISIBLE_PANEL_FN}
    const panel = visibleFieldPanel();
    if (!panel) return false;
    const names = ${JSON.stringify(names)};
    const norm = (s) => (s || "").replace(/\\s+/g, " ").trim();
    for (const el of panel.querySelectorAll("walla-button, button, [role=button]")) {
      const text = norm(
        (el.shadowRoot && el.shadowRoot.textContent) ||
          el.innerText ||
          el.getAttribute("aria-label"),
      );
      if (!names.includes(text)) continue;
      const inner = el.shadowRoot && el.shadowRoot.querySelector("button");
      (inner || el).click();
      return true;
    }
    return false;
  })()`)) as boolean;
}

async function optionIsChosen(
  page: Page,
  id: string,
  title: string,
): Promise<boolean> {
  return (await page.evaluate(`((title, id) => {
    ${FIND_OPTION_FN}
    const el = findFieldOption(title, id);
    if (!el) return false;
    const input = el.querySelector("input");
    return el.getAttribute("aria-selected") === "true" || Boolean(input && input.checked);
  })(${JSON.stringify(title)}, ${JSON.stringify(id)})`)) as boolean;
}

async function clickOneFieldOption(
  page: Page,
  id: string,
  title: string,
): Promise<boolean> {
  const point = (await page.evaluate(`((title, id) => {
    ${FIND_OPTION_FN}
    const el = findFieldOption(title, id);
    if (!el) return null;
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    const panel = el.closest(".walla-dropdown__floating-area");
    let scroller = panel;
    let node = panel;
    while (node && node !== document.body) {
      if (node.scrollHeight > node.clientHeight + 8) {
        scroller = node;
        break;
      }
      node = node.parentElement;
    }
    const box = (panel || el).getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    if (scroller && rect.bottom > box.bottom - 4) scroller.scrollTop += rect.bottom - box.bottom + 8;
    if (scroller && rect.top < box.top + 4) scroller.scrollTop -= box.top - rect.top + 8;
    const rect2 = el.getBoundingClientRect();
    if (rect2.width < 2 || rect2.height < 2) return null;
    return { x: rect2.x + rect2.width / 2, y: rect2.y + Math.min(rect2.height / 2, 20) };
  })(${JSON.stringify(title)}, ${JSON.stringify(id)})`)) as {
    x: number;
    y: number;
  } | null;
  if (!point) return false;
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(200);
  if (await optionIsChosen(page, id, title)) return true;
  await page.evaluate(`((title, id) => {
    ${FIND_OPTION_FN}
    const el = findFieldOption(title, id);
    if (!el) return;
    const input = el.querySelector("input");
    if (input) input.click();
    else el.click();
  })(${JSON.stringify(title)}, ${JSON.stringify(id)})`);
  await page.waitForTimeout(150);
  return optionIsChosen(page, id, title);
}

/** Click the painted option row. Duplicate #id in leftover menus is ignored. */
async function clickFieldOptions(
  page: Page,
  titles: string[],
  optionIds: string[],
): Promise<number> {
  const panel = openPanel(page);
  await panel.waitFor({ state: "visible", timeout: 5_000 });
  await clickPanelButton(page, ["Borrar", "Limpiar"]);
  await page.waitForTimeout(250);
  let n = 0;
  for (let i = 0; i < optionIds.length; i++) {
    const id = optionIds[i];
    if (await clickOneFieldOption(page, id, titles[i] ?? id)) n += 1;
  }
  await clickPanelButton(page, ["Seleccionar", "Aplicar"]);
  await page.waitForTimeout(400);
  return n;
}

async function fieldHostPresent(
  page: Page,
  id: string,
  label: string,
): Promise<boolean> {
  return (await page.evaluate(
    `${HOST_PRESENT_JS}(${JSON.stringify(id)}, ${JSON.stringify(label)})`,
  )) as boolean;
}

/** Color is required in CRM, but some leaves never render the dropdown. */
async function waitForColorHost(page: Page, label: string): Promise<boolean> {
  const deadline = Date.now() + COLOR_HOST_WAIT_MS;
  while (Date.now() <= deadline) {
    if (await fieldHostPresent(page, "color", label)) return true;
    await page.waitForTimeout(COLOR_HOST_POLL_MS);
  }
  return false;
}

async function clickOpenedField(
  page: Page,
  titles: string[],
  ids: string[],
  opened: boolean,
): Promise<number> {
  if (!opened) return 0;
  try {
    return await clickFieldOptions(page, titles, ids);
  } catch {
    return 0;
  }
}

const FIELD_SHOWS_JS = `((id, label, titles) => {
  const host = ${FIND_HOST_JS}(id, label);
  if (!host) return false;
  const blob = [
    host.getAttribute("aria-label"),
    host.innerText,
    ...[...host.querySelectorAll("[aria-label]")].map((el) =>
      el.getAttribute("aria-label"),
    ),
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\\s+/g, " ");
  return titles.some((title) => title && blob.includes(title));
})`;

async function fieldShowsTitles(
  page: Page,
  field: CategoryUploadField,
  titles: string[],
): Promise<boolean> {
  return (await page.evaluate(
    `${FIELD_SHOWS_JS}(${JSON.stringify(field.id)}, ${JSON.stringify(field.label)}, ${JSON.stringify(titles)})`,
  )) as boolean;
}

async function colorHostMissing(
  page: Page,
  field: CategoryUploadField,
  ids: string[],
  titles: string[],
): Promise<boolean> {
  if (field.id !== "color") return false;
  if (await fieldHostPresent(page, field.id, field.label)) return false;
  if (await waitForColorHost(page, field.label)) return false;
  log("info", "wallapop_publish_extra_field", {
    id: field.id,
    opened: false,
    clicked: 0,
    titles,
    ids,
    skipped: "host_absent",
  });
  return true;
}

async function fillOneExtraField(
  page: Page,
  field: CategoryUploadField,
  ids: string[],
): Promise<void> {
  const titles = titlesForIds(field, ids);
  await closeOpenDropdowns(page);
  if (await colorHostMissing(page, field, ids, titles)) return;
  const opened = (await page.evaluate(
    `${OPEN_FIELD_JS}(${JSON.stringify(field.id)}, ${JSON.stringify(field.label)})`,
  )) as boolean;
  let clicked = await clickOpenedField(page, titles, ids, opened);
  const alreadyOn = await fieldShowsTitles(page, field, titles);
  if (clicked < 1 && alreadyOn) clicked = titles.length;
  await closeOpenDropdowns(page);
  log("info", "wallapop_publish_extra_field", {
    id: field.id,
    opened,
    clicked,
    titles,
    ids,
    alreadyOn,
  });
  if (field.required && clicked < 1 && !alreadyOn) {
    throw new WallapopPublishError(
      "form",
      `No se pudo seleccionar ${field.label} en Wallapop.`,
    );
  }
}

export async function ensureExtraUploadFields(
  page: Page,
  fields: CategoryUploadField[],
  typeAttributes: unknown,
): Promise<void> {
  for (const field of extraUploadFields(fields)) {
    const ids = selectedIdsForField(typeAttributes, field.id);
    if (field.required && ids.length < Math.max(1, field.min)) {
      throw new WallapopPublishError(
        "form",
        `Falta ${field.label} en el producto. Wallapop no deja publicar sin este campo.`,
      );
    }
    if (ids.length === 0) continue;
    if (field.id === "brand" || field.type === "combo_box") continue;
    await fillOneExtraField(page, field, ids);
  }
}
