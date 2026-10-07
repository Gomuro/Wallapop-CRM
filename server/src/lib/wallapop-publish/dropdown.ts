import type { Page } from "playwright";

export async function closeOpenDropdowns(page: Page): Promise<void> {
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(250);
}

/** Options inside one Wallapop field. Never scans photo drop-areas. */
const DROPDOWN_ROOT_JS: Record<"condition" | "marca", string> = {
  condition: `document.querySelector("#condition")?.closest("walla-dropdown, tsl-upload-form-dropdown") || document.querySelector('walla-dropdown[data-testid="condition"]')`,
  marca: `(() => {
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
