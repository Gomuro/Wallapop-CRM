import type { Page } from "playwright";

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

export async function envioToggleIsOn(page: Page): Promise<boolean | null> {
  const el = envioToggle(page);
  if (!(await el.count().catch(() => 0))) return null;
  return Boolean(await el.isChecked().catch(() => false));
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
  await el.waitFor({ state: "visible", timeout: 8_000 }).catch(() => {});
  await el.scrollIntoViewIfNeeded().catch(() => {});
  const on = await el.isChecked().catch(() => null);
  if (on === enabled) {
    log("info", "wallapop_publish_envio_toggle_already", { enabled });
    return;
  }
  await el.click({ timeout: 5_000 });
  const after = await el.isChecked().catch(() => null);
  log("info", "wallapop_publish_envio_toggle_clicked", { want: enabled, after });
  if (after !== enabled) {
    log("warn", "wallapop_publish_envio_toggle_mismatch", { want: enabled, after });
  }
}
