import type { Page } from "playwright";

import { wallapopItemUrlOrNull } from "../../../../lib/inventory/wallapop-item-url";
import { log } from "../log";
import {
  PUBLICAR_LANDING_MAX_MS,
  PUBLICAR_LANDING_POLL_MS,
  PUBLICAR_SETTLE_MS,
  type PageUrlReader,
  type PublishLandingVerdict,
} from "./types";

export { normalizePublishTitle } from "./types";

export function listingUrlFromPageUrl(url: string): string | null {
  return wallapopItemUrlOrNull(url);
}

export function isWallapopPublishedCatalogUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host !== "wallapop.com" && !host.endsWith(".wallapop.com")) return false;
    return /\/app\/catalog\/(?:published|management)(\/|$)/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function isWallapopUploadFormUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /\/upload(\/|$)/i.test(parsed.pathname);
  } catch {
    return /\/upload/i.test(url);
  }
}

/** D9: posted on Tu Catálogo, the Pro management catalog, or a rare /item/ redirect. */
export function classifyPublishLanding(input: {
  url: string | null;
  urlReadFailed: boolean;
  reviewMessage: string | null;
}): PublishLandingVerdict {
  if (input.urlReadFailed || input.url == null || input.url.trim() === "") {
    return {
      ok: false,
      reason: "target_closed",
      message:
        "No se pudo comprobar el catálogo tras Publicar (pestaña cerrada). El listing no se marcó ACTIVE.",
    };
  }
  if (input.reviewMessage) {
    return {
      ok: false,
      reason: "review_banner",
      message: input.reviewMessage,
    };
  }
  if (isWallapopUploadFormUrl(input.url)) {
    return {
      ok: false,
      reason: "still_on_upload",
      message:
        "Publicar se pulsó, pero el formulario de alta sigue abierto.",
    };
  }
  if (isWallapopPublishedCatalogUrl(input.url)) {
    return { ok: true, reason: "published_catalog" };
  }
  if (wallapopItemUrlOrNull(input.url)) {
    return { ok: true, reason: "item_url" };
  }
  return {
    ok: false,
    reason: "unexpected_url",
    message: `Tras Publicar la página no es el catálogo publicado (${input.url}). El listing no se marcó ACTIVE.`,
  };
}

/**
 * Playwright tore down the tab/context after (or during) in-page click.
 * Treat as posted: the DOM click may already have run; reverting would duplicate.
 */
export function isPublicarContextDestroyedError(error: unknown): boolean {
  const message = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase();
  return (
    message.includes("target closed") ||
    message.includes("execution context was destroyed") ||
    message.includes("page closed") ||
    (message.includes("protocol error") && message.includes("closed"))
  );
}

/**
 * After Publicar: wait, then read the landing URL.
 * Still on the upload form: keep reading until it leaves or `maxMs` runs out.
 * Target closed → urlReadFailed (D9: not ACTIVE).
 */
export async function readLandingAfterPublicarClick(
  page: PageUrlReader,
  settleMs = PUBLICAR_SETTLE_MS,
  maxMs = PUBLICAR_LANDING_MAX_MS,
): Promise<{ url: string | null; urlReadFailed: boolean }> {
  try {
    await page.waitForTimeout(settleMs);
    let url = page.url();
    for (
      let waited = settleMs;
      url && isWallapopUploadFormUrl(url) && waited < maxMs;
      waited += PUBLICAR_LANDING_POLL_MS
    ) {
      await page.waitForTimeout(PUBLICAR_LANDING_POLL_MS);
      url = page.url();
    }
    return { url: url || null, urlReadFailed: !url };
  } catch (error) {
    log("warn", "wallapop_publish_url_after_publicar_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    if (isPublicarContextDestroyedError(error)) {
      return { url: null, urlReadFailed: true };
    }
    throw error;
  }
}

export async function readUrlAfterPublicarClick(
  page: PageUrlReader,
  settleMs = PUBLICAR_SETTLE_MS,
): Promise<string | null> {
  const landing = await readLandingAfterPublicarClick(page, settleMs);
  if (landing.urlReadFailed || landing.url == null) return null;
  return listingUrlFromPageUrl(landing.url);
}

const UPLOAD_REVIEW_MESSAGE_EVAL = `(() => {
  const text = document.body ? document.body.innerText : "";
  if (/Revisa los campos/i.test(text) || /Revisa la información/i.test(text)) {
    return "Wallapop pidió revisar campos en rojo (Marca u otros). El anuncio no se publicó.";
  }
  if (/Campo obligatorio/i.test(text) && /Marca/i.test(text)) {
    return "Falta Marca en Wallapop. El anuncio no se publicó.";
  }
  return null;
})()`;

const CLICK_CAUSE_RE =
  /outside of the viewport|intercepts pointer events|element is not visible|element is not enabled|element is not stable|element was detached|not attached to the DOM|Timeout \d+ms exceeded/i;

/** One line: Playwright's click error, plus the cause from its call log. */
export function playwrightClickMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const head = lines[0] ?? "Playwright click failed";
  const cause = [...lines]
    .reverse()
    .find((line) => CLICK_CAUSE_RE.test(line) && line !== head);
  if (!cause) return head;
  const detail = cause.replace(/^[-–—]\s*/, "").replace(/^\d+\s*×\s*/, "");
  if (detail === head) return head;
  return `${head} ${detail}`;
}

export async function wallapopUploadReviewMessage(
  page: Page,
): Promise<string | null> {
  try {
    return (await page.evaluate(UPLOAD_REVIEW_MESSAGE_EVAL)) as string | null;
  } catch {
    return null;
  }
}
