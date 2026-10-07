import type { Page } from "playwright";

import { wallapopBrandFromProduct } from "../../../../lib/inventory/wallapop-brand";
import { log } from "../log";
import {
  clickOpenListboxOption,
  listFieldDropdownOptions,
  listOpenDropdownOptions,
  openHiddenFieldDropdown,
  closeOpenDropdowns,
} from "./dropdown";
import { readPublishDescription } from "./fields";
import {
  dumpMarcaCombo,
  marcaFieldShown,
  queryMarcaCombo,
  readBrandValue,
  typeMarcaCombo,
} from "./marca-combo";
import { fillIfEmpty } from "./nav";
import { WallapopPublishError } from "./types";

function marcaCrearScanJs(wanted: string): string {
  return `((wanted) => {
    const want = String(wanted || "").toLowerCase();
    const clip = (s) => String(s || "").replace(/\\s+/g, " ").trim();
    const walk = (root, acc) => {
      if (!root || !root.querySelectorAll) return acc;
      for (const el of root.querySelectorAll("*")) {
        acc.push(el);
        if (el.shadowRoot) walk(el.shadowRoot, acc);
      }
      return acc;
    };
    const nodes = walk(document, []);
    const hits = nodes
      .map((el) => ({ el, text: clip(el.textContent) }))
      .filter((row) => /^Crear\\b/i.test(row.text) && row.text.length < 80);
    const match =
      hits.find((row) => row.text.toLowerCase().includes(want)) || hits[0];
    if (!match) {
      return { clicked: false, hits: hits.map((row) => row.text).slice(0, 8) };
    }
    match.el.click();
    match.el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
    );
    return { clicked: true, text: match.text, hits: hits.map((row) => row.text).slice(0, 8) };
  })(${JSON.stringify(wanted)})`;
}

const CLICK_MARCA_CATALOG_JS = `((wanted) => {
    const want = String(wanted || "").toLowerCase();
    const items = [...document.querySelectorAll("wallapop-combo-box-item")];
    const match = items.find((el) => {
      const aria = (el.getAttribute("aria-label") || "").trim().toLowerCase();
      return aria === want;
    });
    if (!match) return false;
    match.click();
    return true;
  })`;

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

async function clickMarcaCatalogItem(
  page: Page,
  wanted: string,
): Promise<boolean> {
  const clicked = (await page.evaluate(
    `${CLICK_MARCA_CATALOG_JS}(${JSON.stringify(wanted)})`,
  )) as boolean;
  if (clicked) await page.waitForTimeout(500);
  return Boolean(clicked);
}

async function clickMarcaCrear(page: Page, wanted: string): Promise<boolean> {
  const result = (await page.evaluate(marcaCrearScanJs(wanted))) as {
    clicked?: boolean;
    text?: string;
    hits?: string[];
  };
  log("info", "wallapop_publish_marca_crear_scan", {
    wanted,
    clicked: Boolean(result?.clicked),
    text: result?.text || null,
    hits: result?.hits || [],
  });
  if (!result?.clicked) return false;
  await page.waitForTimeout(700);
  log("info", "wallapop_publish_marca_crear_clicked", {
    wanted,
    via: "shadow",
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
  await dumpMarcaCombo(page, "after_pick");
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
  await dumpMarcaCombo(page, "before_fail");
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
  await dumpMarcaCombo(page, "before_fail");
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
  await dumpMarcaCombo(page, "field_found");
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
