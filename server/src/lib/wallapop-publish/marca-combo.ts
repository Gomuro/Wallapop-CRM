import type { Page } from "playwright";

import { log } from "../log";

const QUERY_MARCA_COMBO_EVAL = `(() => {
    const labels = [...document.querySelectorAll("label")];
    const label = labels.find((el) => /Marca\\s*\\*/i.test(el.textContent || ""));
    if (!label) return null;
    const forId = label.getAttribute("for");
    const input =
      (forId && document.getElementById(forId)) ||
      label.closest(".inputWrapper")?.querySelector("input") ||
      null;
    if (!(input instanceof HTMLInputElement)) return null;
    return { id: input.id || "", value: String(input.value || "").trim() };
  })()`;

const READ_BRAND_VALUE_EVAL = `(() => {
      const clip = (s) => String(s || "").replace(/\\s+/g, " ").trim();
      const hidden = document.querySelector("#brand, input[name='brand']");
      if (hidden instanceof HTMLInputElement && clip(hidden.value)) {
        return clip(hidden.value);
      }
      const selected = [
        ...document.querySelectorAll(
          "wallapop-combo-box-item[aria-selected='true'], wallapop-combo-box-item[aria-checked='true']",
        ),
      ][0];
      const fromItem = clip(
        selected?.getAttribute("aria-label") || selected?.textContent,
      );
      if (fromItem) return fromItem;
      return "";
    })()`;

const MARCA_FIELD_SHOWN_EVAL = `(() => {
      if (document.querySelector("#brand, input[name='brand'], [formcontrolname='brand']")) {
        return true;
      }
      const text = document.body ? document.body.innerText : "";
      return /Marca\\s*\\*/.test(text);
    })()`;

const DUMP_MARCA_COMBO_EVAL = `(() => {
      const clip = (s, n) => String(s || "").replace(/\\s+/g, " ").trim().slice(0, n);
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return (
          r.width > 2 &&
          r.height > 2 &&
          s.visibility !== "hidden" &&
          s.display !== "none" &&
          Number(s.opacity || "1") > 0
        );
      };
      const labels = [...document.querySelectorAll("label")];
      const lab = labels.find((el) => /Marca\\s*\\*/i.test(el.textContent || ""));
      const forId = lab?.getAttribute("for") || "";
      const input = forId ? document.getElementById(forId) : null;
      const host =
        input?.closest(
          "tsl-upload-form-field-host, wallapop-combo-box, walla-combo-box, walla-text-input",
        ) || null;
      const bodyText = document.body ? document.body.innerText : "";
      const floating = [...document.querySelectorAll("walla-floating-area")].map((el) => ({
        cls: clip(el.className, 160),
        closed: /wrapper--closed|wrapper--hidden/.test(String(el.className || "")),
        vis: vis(el),
        text: clip(el.innerText, 220),
        optionCount: el.querySelectorAll(
          '[role="option"], walla-dropdown-item, walla-list-item, wallapop-combo-box-item',
        ).length,
      }));
      const roleOptions = [...document.querySelectorAll('[role="option"]')]
        .slice(0, 25)
        .map((el) => ({
          tag: el.tagName,
          aria: clip(el.getAttribute("aria-label"), 80),
          text: clip(el.textContent, 80),
          vis: vis(el),
        }));
      const openPanel = [...document.querySelectorAll("walla-floating-area")].find(
        (el) => vis(el) && !/wrapper--closed/.test(String(el.className || "")),
      );
      const panelLines = clip(openPanel?.innerText, 500)
        .split(/(?<=\\S)\\s{2,}|(?=Seleccione)/)
        .map((t) => clip(t, 80))
        .filter(Boolean)
        .slice(0, 20);
      return {
        inputId: input && "id" in input ? String(input.id || forId) : forId || null,
        inputValue:
          input instanceof HTMLInputElement ? String(input.value || "") : "",
        inputMode: input?.getAttribute?.("inputmode") || null,
        hostTag: host?.tagName || null,
        hostClass: clip(host?.className, 120),
        hasSeleccioneHasta: /Seleccione hasta/i.test(bodyText),
        comboBoxCount: document.querySelectorAll(
          "wallapop-combo-box, walla-combo-box",
        ).length,
        roleOptionCount: document.querySelectorAll('[role="option"]').length,
        dropdownItemCount: document.querySelectorAll("walla-dropdown-item").length,
        listItemCount: document.querySelectorAll("walla-list-item").length,
        comboItemCount: document.querySelectorAll("wallapop-combo-box-item").length,
        hasCrear: /Crear\\s/i.test(bodyText),
        hasNoResult: /No se ha encontrado/i.test(bodyText),
        comboItemSample: [...document.querySelectorAll("wallapop-combo-box-item")]
          .slice(0, 8)
          .map((el) => clip(el.getAttribute("aria-label") || el.textContent, 60)),
        floating,
        roleOptions,
        panelLines,
        panelHtml: clip(openPanel?.outerHTML, 900),
        hostHtml: clip(host?.outerHTML, 700),
      };
    })()`;

const CLEAR_MARCA_INPUT_JS = `((id) => {
    const el = document.getElementById(id);
    if (!(el instanceof HTMLInputElement)) return false;
    const header = document.querySelector(".PrivateLayout__header, tsl-topbar");
    const headerH = header ? header.getBoundingClientRect().height : 0;
    el.scrollIntoView({ block: "center", inline: "nearest" });
    const top = el.getBoundingClientRect().top;
    if (top < headerH + 12) window.scrollBy(0, top - headerH - 24);
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter ? setter.call(el, "") : (el.value = "");
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
    return true;
  })`;

export async function queryMarcaCombo(page: Page): Promise<{
  id: string;
  value: string;
} | null> {
  return (await page.evaluate(QUERY_MARCA_COMBO_EVAL)) as {
    id: string;
    value: string;
  } | null;
}

export async function readBrandValue(page: Page): Promise<string> {
  return ((await page.evaluate(READ_BRAND_VALUE_EVAL)) as string) || "";
}

export async function marcaFieldShown(page: Page): Promise<boolean> {
  if (await queryMarcaCombo(page)) return true;
  return Boolean(await page.evaluate(MARCA_FIELD_SHOWN_EVAL));
}

export async function dumpMarcaCombo(page: Page, phase: string): Promise<void> {
  try {
    const dump = (await page.evaluate(DUMP_MARCA_COMBO_EVAL)) as Record<
      string,
      unknown
    >;
    log("info", "wallapop_publish_marca_dump", { phase, ...dump });
  } catch (err) {
    log("warn", "wallapop_publish_marca_dump_failed", {
      phase,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function typeMarcaCombo(
  page: Page,
  inputId: string,
  wanted: string,
): Promise<void> {
  await page.evaluate(`${CLEAR_MARCA_INPUT_JS}(${JSON.stringify(inputId)})`);
  await page.keyboard.type(wanted, { delay: 40 });
  const typed = await page.evaluate(
    `((id) => {
      const el = document.getElementById(id);
      return el instanceof HTMLInputElement ? el.value : "";
    })(${JSON.stringify(inputId)})`,
  );
  log("info", "wallapop_publish_marca_type", {
    step: "typed",
    inputId,
    wanted,
    value: typed,
  });
  await page.waitForTimeout(800);
  await dumpMarcaCombo(page, "after_type");
}
