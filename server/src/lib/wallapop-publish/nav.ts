import type { Page } from "playwright";

import { FINAL_RE } from "./types";

export const VISIBLE_BUTTON_LABELS_EVAL = `(() => {
    const visible = (el) => {
      const s = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0;
    };
    const labelOf = (el) => {
      const shadowBtn = el.shadowRoot?.querySelector?.("button");
      return (
        el.innerText ||
        el.getAttribute("aria-label") ||
        el.getAttribute("text") ||
        shadowBtn?.innerText ||
        shadowBtn?.getAttribute("aria-label") ||
        ""
      )
        .trim()
        .replace(/\\s+/g, " ")
        .slice(0, 100);
    };
    return [...document.querySelectorAll("button, [role=button], walla-button")]
      .filter(visible)
      .map(labelOf)
      .filter(Boolean);
  })()`;

export async function visibleButtonLabels(page: Page): Promise<string[]> {
  const labels = (await page.evaluate(VISIBLE_BUTTON_LABELS_EVAL)) as string[];
  return labels.map((t) => t.slice(0, 60)).slice(0, 12);
}

export async function readAllVisibleButtonLabels(
  page: Page,
): Promise<string[]> {
  return (await page.evaluate(VISIBLE_BUTTON_LABELS_EVAL)) as string[];
}

const DISMISS_SEARCH_EVAL = `(() => {
    const s = document.querySelector('input[name="search"]');
    if (s) { s.value = ""; s.dispatchEvent(new Event("input", { bubbles: true })); s.blur(); }
  })()`;

export async function dismissSearchOverlay(page: Page): Promise<void> {
  await page.evaluate(DISMISS_SEARCH_EVAL);
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
}

export async function clickExactButtonText(
  page: Page,
  text: string,
): Promise<boolean> {
  const clicked = await page.evaluate(`(() => {
    const label = ${JSON.stringify(text)};
    const buttons = [...document.querySelectorAll("button")];
    const match = buttons.find((b) => (b.innerText || "").trim() === label);
    if (!match) return false;
    match.click();
    return true;
  })()`);
  if (clicked) await page.waitForTimeout(2_500);
  return Boolean(clicked);
}

export async function clickEnabledContinuar(
  page: Page,
): Promise<"OK" | "FINAL" | "NONE"> {
  const btns = page.getByRole("button", { name: /^(Continuar|Siguiente)$/i });
  const n = await btns.count();
  for (let i = 0; i < n; i++) {
    const b = btns.nth(i);
    const t = (await b.innerText().catch(() => "")).trim();
    if (FINAL_RE.test(t)) return "FINAL";
    if (await b.isDisabled().catch(() => true)) continue;
    await b.scrollIntoViewIfNeeded().catch(() => {});
    await b.click({ force: true });
    await page.waitForTimeout(4_000);
    return "OK";
  }
  return "NONE";
}

export async function clickMainText(page: Page, text: string): Promise<boolean> {
  const loc = page.getByText(text, { exact: true });
  const n = await loc.count();
  for (let i = 0; i < n; i++) {
    const box = await loc.nth(i).boundingBox();
    if (!box || box.x < 280 || box.y < 80) continue;
    await loc.nth(i).click({ force: true });
    await page.waitForTimeout(800);
    return true;
  }
  return false;
}

export async function fillIfEmpty(
  page: Page,
  selectors: readonly string[],
  value: string,
): Promise<boolean> {
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (!(await el.count())) continue;
    if (!(await el.isVisible().catch(() => false))) continue;
    const cur = await el.inputValue().catch(() => "");
    if (cur?.trim()) return false;
    await el.fill(value, { force: true }).catch(() => {});
    return true;
  }
  return false;
}
