import type { Page } from "playwright";

import { wallapopBrandFromProduct } from "../../../../lib/inventory/wallapop-brand";
import { log } from "../log";
import {
  clickMarcaCatalogItem,
  clickMarcaCrearOption,
  clickOpenListboxOption,
  closeOpenDropdowns,
  listFieldDropdownOptions,
  listOpenDropdownOptions,
  openHiddenFieldDropdown,
  queryMarcaCombo,
} from "./dropdown";
import { readPublishDescription } from "./fields";
import {
  marcaFieldShown,
  readBrandValue,
  typeMarcaCombo,
} from "./marca-combo";
import { fillIfEmpty } from "./nav";
import { WallapopPublishError } from "./types";

const MARCA_LOOKS_SELECTED_JS = `((wanted) => {
      const want = String(wanted || "").toLowerCase();
      const combo = document.querySelector("wallapop-combo-box");
      const text = (combo?.innerText || "").replace(/\\s+/g, " ").toLowerCase();
      if (!text.includes(want)) return false;
      if (/no se ha encontrado/.test(text)) return false;
      const host = combo?.querySelector(".inputWrapper");
      return Boolean(host && /inputWrapper--filled/.test(host.className || ""));
    })`;

const TYPE_HIDDEN_BRAND_JS = `((v) => {
    const el = document.querySelector(
      "#brand, input[name=brand], input[aria-label*='Marca' i]",
    );
    if (!el) return false;
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter ? setter.call(el, v) : (el.value = v);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: v, inputType: "insertText" }));
    return true;
  })`;

async function clickMarcaCrear(page: Page, wanted: string): Promise<boolean> {
  const result = await clickMarcaCrearOption(page, wanted);
  log("info", "wallapop_publish_marca_crear_scan", {
    wanted,
    clicked: result.clicked,
    text: result.text || null,
    hits: result.hits,
  });
  if (!result.clicked) return false;
  log("info", "wallapop_publish_marca_crear_clicked", {
    wanted,
    via: "panel",
    text: result.text,
  });
  return true;
}

async function pickMarcaSuggestion(
  page: Page,
  wanted: string,
): Promise<boolean> {
  if (await clickMarcaCatalogItem(page, wanted)) return true;
  for (let attempt = 0; attempt < 6; attempt++) {
    if (await clickMarcaCrear(page, wanted)) return true;
    await page.waitForTimeout(400);
  }
  return Boolean((await readBrandValue(page)).trim());
}

async function marcaLooksSelected(
  page: Page,
  wanted: string,
): Promise<boolean> {
  if ((await readBrandValue(page)).toLowerCase() === wanted.toLowerCase()) {
    return true;
  }
  return Boolean(
    await page.evaluate(
      `${MARCA_LOOKS_SELECTED_JS}(${JSON.stringify(wanted)})`,
    ),
  );
}

async function resolveWantedBrand(
  page: Page,
  brand?: string | null,
): Promise<string> {
  return (
    brand?.trim() ||
    wallapopBrandFromProduct({
      description: await readPublishDescription(page),
    }) ||
    ""
  );
}

async function selectMarcaViaCombo(
  page: Page,
  comboId: string,
  wanted: string,
): Promise<void> {
  await typeMarcaCombo(page, comboId, wanted);
  const options = await listFieldDropdownOptions(page, "marca");
  log("info", "wallapop_publish_marca_try", { wanted, via: "combo", options });
  const picked = await pickMarcaSuggestion(page, wanted);
  const afterPick = await readBrandValue(page);
  const looksSelected = await marcaLooksSelected(page, wanted);
  log("info", "wallapop_publish_marca_pick_result", {
    wanted,
    picked,
    value: afterPick,
    looksSelected,
  });
  if (afterPick.trim() || looksSelected) {
    log("info", "wallapop_publish_marca_selected", {
      wanted,
      value: afterPick || wanted,
      picked,
      looksSelected,
    });
    return;
  }
  throw new WallapopPublishError(
    "form",
    `No se pudo seleccionar la marca (${wanted}).`,
  );
}

const BRAND_SELECTORS = [
  'input[name="brand"]',
  "#brand",
  'input[aria-label*="Marca" i]',
  'input[placeholder*="Marca" i]',
] as const;

async function selectMarcaViaHidden(page: Page, wanted: string): Promise<void> {
  await fillIfEmpty(page, BRAND_SELECTORS, wanted);
  if ((await readBrandValue(page)).trim()) return;
  const opened = await openHiddenFieldDropdown(page, "brand");
  const typed = await page.evaluate(
    `${TYPE_HIDDEN_BRAND_JS}(${JSON.stringify(wanted)})`,
  );
  if (typed) await page.keyboard.type(wanted, { delay: 25 }).catch(() => {});
  const options = await listOpenDropdownOptions(page);
  log("info", "wallapop_publish_marca_try", {
    wanted,
    opened,
    typed,
    via: "hidden",
    options,
  });
  await clickOpenListboxOption(page, wanted);
  await page.waitForTimeout(400);
  if ((await readBrandValue(page)).trim()) {
    log("info", "wallapop_publish_marca_selected", {
      wanted,
      value: await readBrandValue(page),
    });
    return;
  }
  throw new WallapopPublishError(
    "form",
    `No se pudo seleccionar la marca (${wanted}).`,
  );
}

export async function ensureMarcaIfShown(
  page: Page,
  brand?: string | null,
): Promise<void> {
  if (!(await marcaFieldShown(page))) {
    log("info", "wallapop_publish_marca_skip", { reason: "field_absent" });
    return;
  }
  if ((await readBrandValue(page)).trim()) {
    log("info", "wallapop_publish_marca_already", {
      value: await readBrandValue(page),
    });
    return;
  }
  await closeOpenDropdowns(page);
  const wanted = await resolveWantedBrand(page, brand);
  const combo = await queryMarcaCombo(page);
  log("info", "wallapop_publish_marca_field", {
    wanted: wanted || null,
    comboId: combo?.id || null,
    hasHiddenBrand: Boolean(await page.locator("#brand").count()),
  });
  if (!wanted) {
    throw new WallapopPublishError(
      "form",
      "Wallapop exige Marca en esta categoría. Añádela en el CRM antes de publicar.",
    );
  }
  if (combo?.id) {
    await selectMarcaViaCombo(page, combo.id, wanted);
    return;
  }
  await selectMarcaViaHidden(page, wanted);
}
