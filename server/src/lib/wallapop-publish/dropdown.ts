import type { Page } from "playwright";

export async function closeOpenDropdowns(page: Page): Promise<void> {
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(250);
}

/** Options inside one Wallapop field. Never scans photo drop-areas. */
const DROPDOWN_ROOT_JS: Record<"condition" | "marca", string> = {
  condition: `document.querySelector("#condition")?.closest("walla-dropdown, tsl-upload-form-dropdown") || document.querySelector('walla-dropdown[data-testid="condition"]')`,
  marca: `document.querySelector('wallapop-combo-box[data-testid="brand"]') || (() => {
    const labels = [...document.querySelectorAll("label")];
    const lab = labels.find((el) => /Marca\\s*\\*/i.test(el.textContent || ""));
    const forId = lab?.getAttribute("for");
    const input =
      (forId && document.getElementById(forId)) ||
      lab?.closest(".inputWrapper")?.querySelector("input") ||
      null;
    return (
      input?.closest(
        "wallapop-combo-box, walla-combo-box, .sc-wallapop-combo-box, tsl-upload-form-field-host",
      ) ||
      null
    );
  })()`,
};

const OPTION_SCAN_INNER = `
    if (!root) return [];
    const text = (el) =>
      (el.getAttribute("aria-label") || el.textContent || "")
        .replace(/\\s+/g, " ")
        .trim();
    return [
      ...root.querySelectorAll(
        'walla-dropdown-item[role="option"], [role="listbox"] [role="option"]',
      ),
    ]
      .filter(
        (el) =>
          el.getAttribute("aria-disabled") !== "true" &&
          !/drop area/i.test(text(el)),
      )
      .map(text)
      .filter(Boolean)
      .slice(0, 20);
`;

function optionScanJs(rootExpr: string): string {
  return `(() => {
    const root = ${rootExpr};
    ${OPTION_SCAN_INNER}
  })()`;
}

const CLICK_LISTBOX_INNER = `
    if (!root) return false;
    const norm = (s) =>
      (s || "")
        .replace(/[\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]/g, "")
        .replace(/\\s+/g, " ")
        .trim()
        .toLowerCase();
    const wanted = norm(label);
    const text = (el) =>
      (el.getAttribute("aria-label") || el.textContent || "")
        .replace(/\\s+/g, " ")
        .trim();
    const items = [
      ...root.querySelectorAll(
        'walla-dropdown-item[role="option"], [role="listbox"] [role="option"]',
      ),
    ].filter(
      (el) =>
        el.getAttribute("aria-disabled") !== "true" &&
        !/drop area/i.test(text(el)),
    );
    const match = items.find((el) => {
      const aria = norm(el.getAttribute("aria-label"));
      const body = norm(el.textContent);
      return (
        aria === wanted ||
        body === wanted ||
        aria.startsWith(wanted) ||
        body.startsWith(wanted) ||
        aria.includes(wanted) ||
        body.includes(wanted)
      );
    });
    if (!match) return false;
    match.click();
    return true;
`;

function clickListboxOptionJs(rootExpr: string, label: string): string {
  return `((label) => {
    const root = ${rootExpr};
    ${CLICK_LISTBOX_INNER}
  })(${JSON.stringify(label)})`;
}

const OPEN_HIDDEN_DROPDOWN_JS = `((hiddenId) => {
    const hidden = document.querySelector("#" + hiddenId);
    if (!hidden) return false;
    const host =
      hidden.closest("tsl-dropdown-form, [formcontrolname]") ||
      hidden.parentElement;
    const dd =
      hidden.closest("walla-dropdown") ||
      host?.querySelector?.("walla-dropdown") ||
      host?.parentElement?.querySelector?.("walla-dropdown");
    const btn =
      dd?.querySelector?.('[role="button"]') ||
      host?.querySelector?.('[role="button"]') ||
      dd;
    if (!btn) return false;
    btn.scrollIntoView?.({ block: "center" });
    btn.click?.();
    return true;
  })`;

export async function listOpenDropdownOptions(page: Page): Promise<string[]> {
  return (await page.evaluate(optionScanJs(`document`))) as string[];
}

export async function listFieldDropdownOptions(
  page: Page,
  field: "condition" | "marca",
): Promise<string[]> {
  return (await page.evaluate(
    optionScanJs(DROPDOWN_ROOT_JS[field]),
  )) as string[];
}

/** Open the dropdown bound to a hidden input (#condition, #brand). */
export async function openHiddenFieldDropdown(
  page: Page,
  hiddenId: string,
): Promise<boolean> {
  await closeOpenDropdowns(page);
  const opened = (await page.evaluate(
    `${OPEN_HIDDEN_DROPDOWN_JS}(${JSON.stringify(hiddenId)})`,
  )) as boolean;
  await page.waitForTimeout(900);
  return Boolean(opened);
}

export async function clickListboxOptionInRoot(
  page: Page,
  label: string,
  rootExpr: string,
): Promise<boolean> {
  const clicked = (await page.evaluate(
    clickListboxOptionJs(rootExpr, label),
  )) as boolean;
  if (clicked) await page.waitForTimeout(1_000);
  return Boolean(clicked);
}

export async function clickOpenListboxOption(
  page: Page,
  label: string,
): Promise<boolean> {
  return clickListboxOptionInRoot(page, label, "document");
}

export async function clickFieldDropdownOption(
  page: Page,
  field: "condition" | "marca",
  label: string,
): Promise<boolean> {
  return clickListboxOptionInRoot(page, label, DROPDOWN_ROOT_JS[field]);
}

/** Combo host plus open suggestion panels — never the page header. */
const MARCA_SCOPE_ROOTS = `
    const field = ${DROPDOWN_ROOT_JS.marca};
    const panels = [...document.querySelectorAll("walla-floating-area")].filter((el) => {
      const closed = /wrapper--closed|wrapper--hidden/.test(String(el.className || ""));
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return (
        !closed &&
        r.height > 2 &&
        s.display !== "none" &&
        s.visibility !== "hidden"
      );
    });
    const roots = [field, ...panels].filter(Boolean);
`;

function clickMarcaCatalogJs(wanted: string): string {
  return `((wanted) => {
    ${MARCA_SCOPE_ROOTS}
    const want = String(wanted || "").toLowerCase();
    for (const root of roots) {
      const items = [...root.querySelectorAll("wallapop-combo-box-item")];
      const match = items.find((el) => {
        const aria = (el.getAttribute("aria-label") || "").trim().toLowerCase();
        return aria === want;
      });
      if (match) {
        match.click();
        return true;
      }
    }
    return false;
  })(${JSON.stringify(wanted)})`;
}

function clickMarcaCrearJs(wanted: string): string {
  return `((wanted) => {
    ${MARCA_SCOPE_ROOTS}
    const want = String(wanted || "").toLowerCase();
    const clip = (s) => String(s || "").replace(/\\s+/g, " ").trim();
    const walk = (node, acc) => {
      if (!node || !node.querySelectorAll) return acc;
      for (const el of node.querySelectorAll("*")) {
        acc.push(el);
        if (el.shadowRoot) walk(el.shadowRoot, acc);
      }
      return acc;
    };
    const nodes = roots.reduce((acc, root) => walk(root, acc), []);
    const hits = nodes
      .map((el) => ({ el, text: clip(el.textContent) }))
      .filter((row) => /^Crear\\b/i.test(row.text) && row.text.length < 80);
    const leaves = hits.filter(
      (row) => !hits.some((other) => other.el !== row.el && row.el.contains(other.el)),
    );
    const match =
      leaves.find((row) => row.text.toLowerCase().includes(want)) || leaves[0];
    if (!match) {
      return { clicked: false, hits: hits.map((row) => row.text).slice(0, 8) };
    }
    match.el.click();
    match.el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
    );
    return {
      clicked: true,
      text: match.text,
      hits: hits.map((row) => row.text).slice(0, 8),
    };
  })(${JSON.stringify(wanted)})`;
}

export async function queryMarcaCombo(page: Page): Promise<{
  id: string;
  value: string;
} | null> {
  return (await page.evaluate(`(() => {
    const root = ${DROPDOWN_ROOT_JS.marca};
    if (!root) return null;
    const input = root.querySelector("input");
    if (!(input instanceof HTMLInputElement)) return null;
    return { id: input.id || "", value: String(input.value || "").trim() };
  })()`)) as { id: string; value: string } | null;
}

export async function clickMarcaCatalogItem(
  page: Page,
  wanted: string,
): Promise<boolean> {
  const clicked = (await page.evaluate(clickMarcaCatalogJs(wanted))) as boolean;
  if (clicked) await page.waitForTimeout(500);
  return Boolean(clicked);
}

export type MarcaCrearClick = {
  clicked: boolean;
  text?: string;
  hits: string[];
};

export async function clickMarcaCrearOption(
  page: Page,
  wanted: string,
): Promise<MarcaCrearClick> {
  const result = (await page.evaluate(clickMarcaCrearJs(wanted))) as MarcaCrearClick;
  const hits = Array.isArray(result?.hits) ? result.hits : [];
  if (!result?.clicked) return { clicked: false, hits };
  await page.waitForTimeout(700);
  return { clicked: true, text: result.text, hits };
}
