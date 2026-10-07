import type { Page } from "playwright";

import { log } from "../log";
import { queryMarcaCombo } from "./dropdown";

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

const CLEAR_MARCA_INPUT_JS = `((id) => {
    const el = document.getElementById(id);
    if (!(el instanceof HTMLInputElement)) return false;
    el.scrollIntoView({ block: "center", inline: "nearest" });
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter ? setter.call(el, "") : (el.value = "");
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
    return true;
  })`;

export { queryMarcaCombo };

export async function readBrandValue(page: Page): Promise<string> {
  return ((await page.evaluate(READ_BRAND_VALUE_EVAL)) as string) || "";
}

export async function marcaFieldShown(page: Page): Promise<boolean> {
  if (await queryMarcaCombo(page)) return true;
  return Boolean(await page.evaluate(MARCA_FIELD_SHOWN_EVAL));
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
}
