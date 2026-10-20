import type { Page } from "playwright";

async function clickRoleRadio(page: Page, name: string): Promise<void> {
  const radio = page.getByRole("radio", { name, exact: true }).first();
  await radio.waitFor({ state: "visible", timeout: 8_000 });
  await radio.scrollIntoViewIfNeeded();
  await radio.click({ timeout: 5_000 });
}

export async function roleRadioIsChecked(
  page: Page,
  name: string,
): Promise<boolean> {
  const radio = page.getByRole("radio", { name, exact: true }).first();
  if (!(await radio.count().catch(() => 0))) return false;
  return Boolean(await radio.isChecked().catch(() => false));
}

export async function roleRadioIsVisible(page: Page, name: string): Promise<boolean> {
  const radio = page.getByRole("radio", { name, exact: true }).first();
  if (!(await radio.count().catch(() => 0))) return false;
  return Boolean(await radio.isVisible().catch(() => false));
}

export { clickRoleRadio };
