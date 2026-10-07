import type { Locator, Page } from "playwright";

import { log } from "../log";

/** Stencil `wallapop-toggle` plus native checkbox fallbacks on the upload form. */
export const ENVIO_TOGGLE_SEL = [
  "wallapop-toggle input[type=checkbox]",
  'input[type=checkbox][aria-label*="Activar envío" i]',
  'input[type=checkbox][aria-label*="Activate shipping" i]',
].join(", ");

function envioToggle(page: Page) {
  return page.locator(ENVIO_TOGGLE_SEL).first();
}

/** Visible host — the inner checkbox is often `opacity:0` / not hit-testable. */
function envioToggleHost(page: Page) {
  return page
    .locator(
      '[data-testid="shipping-toggle"] wallapop-toggle, [data-testid="shipping-toggle"], wallapop-toggle',
    )
    .first();
}

export async function envioToggleIsOn(page: Page): Promise<boolean | null> {
  const el = envioToggle(page);
  if (!(await el.count().catch(() => 0))) return null;
  return Boolean(await el.isChecked().catch(() => false));
}

async function clickEnvioToggle(page: Page, checkbox: Locator): Promise<void> {
  const host = envioToggleHost(page);
  if (await host.count().catch(() => 0)) {
    await host.scrollIntoViewIfNeeded().catch(() => {});
    await host.click({ timeout: 5_000 });
    return;
  }
  await checkbox.click({ force: true, timeout: 5_000 });
}

export async function ensureEnvioToggle(
  page: Page,
  enabled: boolean,
): Promise<void> {
  const el = envioToggle(page);
  if (!(await el.count().catch(() => 0))) {
    log("info", "wallapop_publish_envio_toggle_absent", { want: enabled });
    return;
  }
  await envioToggleHost(page)
    .waitFor({ state: "visible", timeout: 8_000 })
    .catch(() => {});
  const on = await el.isChecked().catch(() => null);
  if (on === enabled) {
    log("info", "wallapop_publish_envio_toggle_already", { enabled });
    return;
  }
  await clickEnvioToggle(page, el);
  let after = await el.isChecked().catch(() => null);
  if (after !== enabled) {
    await el.click({ force: true, timeout: 5_000 });
    after = await el.isChecked().catch(() => null);
  }
  log("info", "wallapop_publish_envio_toggle_clicked", { want: enabled, after });
  if (after !== enabled) {
    log("warn", "wallapop_publish_envio_toggle_mismatch", { want: enabled, after });
  }
}
