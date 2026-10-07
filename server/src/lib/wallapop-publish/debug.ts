import type { Page } from "playwright";

import { log } from "../log";
import type { PublishStep } from "./types";

export function safePageUrl(page: Page): string {
  try {
    return page.url();
  } catch {
    return "";
  }
}

export function logPublishStep(
  step: PublishStep,
  page: Page,
  extra?: Record<string, unknown>,
): void {
  log("info", "wallapop_publish_step", {
    step,
    url: page.url(),
    ...extra,
  });
}

/** Compact DOM snapshot for VPS logs — no debugger on the Windows box. */
const SNAPSHOT_PUBLISH_FORM_JS = `((preferredNeedle) => {
  const RADIUS = 100;
  const text = document.body ? document.body.innerText : "";
  const boxes = [...document.querySelectorAll("wallapop-toggle input[type=checkbox]")];
  const radios = [...document.querySelectorAll("input[type=radio]")].slice(0, 24).map((el) => ({
    id: el.id || "",
    aria: el.getAttribute("aria-label") || "",
    checked: el.checked,
    value: el.value,
  }));
  const needles = [
    preferredNeedle,
    "cuánto pesa",
    "cuanto pesa",
    "activar envío",
    "activar envio",
    "opciones de envío",
    "opciones de envio",
    "newweightselector",
    "wallapop-toggle",
    "standarddescription",
    "delivery option",
    'id="delivery"',
    "estándar",
    "voluminoso",
    'id="condition"',
    "como nuevo",
  ].filter(Boolean);
  const raw = document.documentElement ? document.documentElement.outerHTML : "";
  const pretty = raw.replace(/></g, ">\\n<");
  const lines = pretty.split("\\n");
  const lower = lines.map((ln) => ln.toLowerCase());
  let hit = -1;
  let needle = "";
  for (const n of needles) {
    hit = lower.findIndex((ln) => ln.includes(n));
    if (hit >= 0) {
      needle = n;
      break;
    }
  }
  if (hit < 0) hit = Math.max(0, Math.floor(lines.length / 2));
  const from = Math.max(0, hit - RADIUS);
  const to = Math.min(lines.length, hit + RADIUS + 1);
  const htmlAround = lines.slice(from, to).map((ln) => ln.slice(0, 400)).join("\\n");
  return {
    title: document.title,
    hasCuantoPesa: /Cuánto pesa|How much/i.test(text),
    hasActivarEnvio: /Activar envío/i.test(text),
    hasEstandar: /Estándar/i.test(text),
    hasVoluminoso: /Voluminoso/i.test(text),
    toggleChecked: boxes.map((el) => el.checked),
    radios,
    condition: document.querySelector("#condition")?.value || "",
    price: document.querySelector("#price_amount")?.value || "",
    categoryLeaf: document.querySelector("#category_leaf_id")?.value || "",
    htmlNeedle: needle || "(mid-page fallback)",
    htmlHitLine: hit,
    htmlFromLine: from,
    htmlToLine: to,
    htmlTotalLines: lines.length,
    htmlAround,
  };
})`;

export async function snapshotPublishForm(
  page: Page,
  preferredNeedle?: string,
): Promise<Record<string, unknown>> {
  try {
    const needle = JSON.stringify(preferredNeedle ?? "");
    return (await page.evaluate(
      `${SNAPSHOT_PUBLISH_FORM_JS}(${needle})`,
    )) as Record<string, unknown>;
  } catch (error) {
    return {
      snapshotError: error instanceof Error ? error.message : String(error),
    };
  }
}
