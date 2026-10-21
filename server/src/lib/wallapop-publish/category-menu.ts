import type { Page } from "playwright";

import { PUBLISH_CATEGORY } from "./types";

type CategoryMenu = {
  leafId: string;
  options: string[];
  /** Closed category control. Open list rows are not included. */
  control: string;
};

/** CRM `nameEs` can trail a space; Wallapop aria-label does not. */
export function normalizeCategoryLabel(label: string): string {
  return label.replace(/\s+/g, " ").trim();
}

const NORM_LABEL_FN = `function normLabel(s) {
  return (s || "").replace(/\\s+/g, " ").trim();
}`;

/** First `[role=listbox]` is often a 0×0 leftover. Use the painted one. */
const VISIBLE_LISTBOX_FN = `function visibleListbox() {
  const boxes = [...document.querySelectorAll('[role="listbox"]')];
  let best = null;
  let bestArea = 0;
  for (const box of boxes) {
    const r = box.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    const area = r.width * r.height;
    if (area > bestArea) {
      best = box;
      bestArea = area;
    }
  }
  return best;
}`;

export async function readCategoryMenu(page: Page): Promise<CategoryMenu> {
  return (await page.evaluate(`(() => {
    ${VISIBLE_LISTBOX_FN}
    const listbox = visibleListbox();
    const options = listbox
      ? [...listbox.querySelectorAll("walla-dropdown-item[role=option]")].map((el) =>
          (el.getAttribute("aria-label") || "").trim(),
        ).filter(Boolean)
      : [];
    const heading = [...document.querySelectorAll("h1,h2,h3,span,label")].find((el) =>
      /Selecciona una categoría/i.test(el.textContent || ""),
    );
    let scope = heading || null;
    for (let i = 0; i < 6 && scope && !scope.querySelector("walla-dropdown"); i += 1) {
      scope = scope.parentElement;
    }
    const dropdown = scope && scope.querySelector
      ? scope.querySelector("walla-dropdown")
      : null;
    const button = dropdown
      ? dropdown.querySelector('div.walla-dropdown__inner-input[role="button"]')
      : document.querySelector('div.walla-dropdown__inner-input[role="button"]');
    const sub = button ? button.querySelector("span.subText") : null;
    const leaf = document.querySelector("#category_leaf_id");
    const aria = button ? button.getAttribute("aria-label") || "" : "";
    const path = sub ? (sub.textContent || "") : "";
    const control = (aria + " " + path).replace(/\\s+/g, " ").trim();
    return {
      leafId: leaf && "value" in leaf ? String(leaf.value || "") : "",
      options,
      control,
    };
  })()`)) as CategoryMenu;
}

export function sameOptionList(left: string[], right: string[]): boolean {
  return left.join("\n") === right.join("\n");
}

/** Virtual lists only render the rows on screen. Scroll until the label is in the DOM. */
export async function scrollMenuForLabel(page: Page, label: string): Promise<boolean> {
  for (let step = 0; step < 24; step += 1) {
    const menu = await readCategoryMenu(page);
    const wanted = normalizeCategoryLabel(label);
    if (menu.options.some((row) => normalizeCategoryLabel(row) === wanted)) {
      return true;
    }
    const moved = (await page.evaluate(`(() => {
      ${VISIBLE_LISTBOX_FN}
      const listbox = visibleListbox();
      if (!listbox) return false;
      let scroller = listbox;
      let node = listbox;
      while (node && node !== document.body) {
        if (node.scrollHeight > node.clientHeight + 8) {
          scroller = node;
          break;
        }
        node = node.parentElement;
      }
      const before = scroller.scrollTop;
      const delta = Math.max(80, scroller.clientHeight - 24);
      scroller.scrollTop = before + delta;
      return scroller.scrollTop !== before;
    })()`)) as boolean;
    if (!moved) return false;
    await page.waitForTimeout(150);
  }
  return false;
}

/** Keep the click inside the open list. `block:center` on the last row jumps outside it. */
export async function clickOpenMenuOption(
  page: Page,
  label: string,
  via: "mouse" | "host" = "mouse",
): Promise<boolean> {
  const point = (await page.evaluate(`((label) => {
    ${VISIBLE_LISTBOX_FN}
    ${NORM_LABEL_FN}
    const listbox = visibleListbox();
    if (!listbox) return null;
    const wanted = normLabel(label);
    const el = [...listbox.querySelectorAll('walla-dropdown-item[role="option"]')].find(
      (item) => normLabel(item.getAttribute("aria-label")) === wanted,
    );
    if (!el) return null;
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    let scroller = listbox;
    let node = listbox;
    while (node && node !== document.body) {
      if (node.scrollHeight > node.clientHeight + 8) {
        scroller = node;
        break;
      }
      node = node.parentElement;
    }
    const box = listbox.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    if (rect.bottom > box.bottom - 4) scroller.scrollTop += rect.bottom - box.bottom + 8;
    if (rect.top < box.top + 4) scroller.scrollTop -= box.top - rect.top + 8;
    const box2 = listbox.getBoundingClientRect();
    const rect2 = el.getBoundingClientRect();
    if (rect2.width < 2 || rect2.height < 2) return null;
    const x = Math.min(
      Math.max(rect2.x + rect2.width / 2, box2.x + 8),
      box2.x + box2.width - 8,
    );
    const y = Math.min(
      Math.max(rect2.y + rect2.height / 2, box2.y + 8),
      box2.y + box2.height - 8,
    );
    if (y < box2.y || y > box2.bottom) return null;
    return { x, y };
  })(${JSON.stringify(label)})`)) as { x: number; y: number } | null;
  if (!point) return false;
  await page.waitForTimeout(200);
  if (via === "host") {
    const clicked = (await page.evaluate(`((label) => {
      ${VISIBLE_LISTBOX_FN}
      ${NORM_LABEL_FN}
      const listbox = visibleListbox();
      if (!listbox) return false;
      const wanted = normLabel(label);
      const el = [...listbox.querySelectorAll('walla-dropdown-item[role="option"]')].find(
        (item) => normLabel(item.getAttribute("aria-label")) === wanted,
      );
      if (!el) return false;
      el.click();
      const inner = el.shadowRoot && el.shadowRoot.querySelector("button, [role='button']");
      if (inner) inner.click();
      return true;
    })(${JSON.stringify(label)})`)) as boolean;
    if (clicked) return true;
  }
  await page.mouse.click(point.x, point.y);
  return true;
}

const CATEGORY_DROPDOWN_OPEN_EVAL = `(() => {
      ${VISIBLE_LISTBOX_FN}
      const listbox = visibleListbox();
      if (!listbox) return false;
      const r = listbox.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      return !!listbox.querySelector("walla-dropdown-item[role=option]");
    })()`;

const SCROLL_CATEGORY_EVAL = `(() => {
    const h1 = [...document.querySelectorAll("h1")].find((h) =>
      /Selecciona una categoría/i.test(h.innerText || ""),
    );
    h1?.scrollIntoView({ block: "center" });
  })()`;

const CLICK_CATEGORY_DROPDOWN_EVAL = `(() => {
    const dd = document.querySelector("walla-dropdown");
    if (dd) {
      const btn = dd.querySelector('[role="button"]') || dd;
      btn?.click?.();
      return true;
    }
    return false;
  })()`;

const CATEGORY_CONTROL_SELECTOR =
  'div.walla-dropdown__inner-input[role="button"][aria-label^="Categoría y subcategoría"]';

export async function categoryDropdownOpen(page: Page): Promise<boolean> {
  return Boolean(await page.evaluate(CATEGORY_DROPDOWN_OPEN_EVAL));
}

async function scrollCategorySectionIntoView(page: Page): Promise<void> {
  await page
    .getByText(PUBLISH_CATEGORY.sectionHeading)
    .first()
    .scrollIntoViewIfNeeded()
    .catch(() => {});
  await page.evaluate(SCROLL_CATEGORY_EVAL);
  await page.waitForTimeout(500);
}

async function clickCategoryControl(page: Page): Promise<boolean> {
  const control = page.locator(CATEGORY_CONTROL_SELECTOR).first();
  if (!(await control.isVisible().catch(() => false))) return false;
  await control.click({ force: true });
  await page.waitForTimeout(900);
  return categoryDropdownOpen(page);
}

async function clickCategoryDropdownHost(page: Page): Promise<boolean> {
  const dropdown = page.locator(PUBLISH_CATEGORY.dropdownTag).filter({
    hasText: PUBLISH_CATEGORY.triggerText,
  });
  if (!(await dropdown.first().isVisible().catch(() => false))) return false;
  await dropdown.first().click({ force: true });
  await page.waitForTimeout(900);
  if (await categoryDropdownOpen(page)) return true;
  const roleBtn = dropdown.first().locator('[role="button"]').first();
  if (!(await roleBtn.isVisible().catch(() => false))) return false;
  await roleBtn.click({ force: true });
  await page.waitForTimeout(900);
  return categoryDropdownOpen(page);
}

async function clickCategoryTriggerByRole(page: Page): Promise<boolean> {
  const byRole = page.getByRole("button", {
    name: PUBLISH_CATEGORY.triggerText,
    exact: true,
  });
  if (!(await byRole.first().isVisible().catch(() => false))) return false;
  await byRole.first().click({ force: true });
  await page.waitForTimeout(900);
  return categoryDropdownOpen(page);
}

export async function openCategoryPicker(page: Page): Promise<void> {
  await scrollCategorySectionIntoView(page);
  if (await categoryDropdownOpen(page)) return;
  if (await clickCategoryControl(page)) return;
  if (await clickCategoryDropdownHost(page)) return;
  if (await clickCategoryTriggerByRole(page)) return;
  await page.evaluate(CLICK_CATEGORY_DROPDOWN_EVAL);
  await page.waitForTimeout(900);
}

/** Parent rows must change the open list. The leaf must land on the closed control. */
export async function clickCategoryOption(
  page: Page,
  label: string,
  leaf: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!(await scrollMenuForLabel(page, label))) return false;
    const before = await readCategoryMenu(page);
    const via = attempt === 0 ? "mouse" : "host";
    if (!(await clickOpenMenuOption(page, label, via))) continue;
    const deadline = Date.now() + 2_500;
    while (Date.now() < deadline) {
      const after = await readCategoryMenu(page);
      if (label === leaf && categoryLeafChosen(before, after, leaf)) return true;
      if (label !== leaf && !sameOptionList(before.options, after.options)) return true;
      await page.waitForTimeout(150);
    }
  }
  return false;
}

/** The closed control often shows the path and omits the leaf name. The hidden id changes. */
export function categoryLeafChosen(
  before: CategoryMenu,
  after: CategoryMenu,
  leaf: string,
): boolean {
  const wanted = normalizeCategoryLabel(leaf);
  if (wanted && normalizeCategoryLabel(after.control).includes(wanted)) {
    return true;
  }
  return Boolean(after.leafId) && after.leafId !== before.leafId;
}
