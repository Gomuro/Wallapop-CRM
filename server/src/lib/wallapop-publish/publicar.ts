import type { Page } from "playwright";

import {
  isInFlightPublishAborted,
  isPublishAbortedError,
  PublishAbortedError,
  throwIfPublishAborted,
} from "../wallapop-cdp";
import { log } from "../log";
import { ensureCrmDescriptionOnForm } from "./fields";
import { assertShippingReadyForPublish } from "./shipping";
import {
  FINAL_RE,
  WallapopPublishError,
  type PublishLandingVerdict,
  type PublishWallapopInput,
  type PublishWallapopResult,
  type SetPublishStep,
} from "./types";
import {
  resolveItemUrlAfterPublish,
} from "./catalog-url";
import {
  classifyPublishLanding,
  isPublicarContextDestroyedError,
  readLandingAfterPublicarClick,
  wallapopUploadReviewMessage,
} from "./verify";

const FINAL_PUBLISH_CLICK_JS = `(() => {
    const re = new RegExp(${JSON.stringify(FINAL_RE.source)}, ${JSON.stringify(FINAL_RE.flags)});
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
        .replace(/\\s+/g, " ");
    };
    const nodes = [...document.querySelectorAll("button, [role=button], walla-button")];
    for (const el of nodes) {
      if (!visible(el)) continue;
      if (!re.test(labelOf(el))) continue;
      const target = el.shadowRoot?.querySelector?.("button") || el;
      target.click();
      return true;
    }
    return false;
  })()`;

async function clickFinalPublish(page: Page): Promise<boolean> {
  throwIfPublishAborted();
  try {
    return Boolean(await page.evaluate(FINAL_PUBLISH_CLICK_JS));
  } catch (error) {
    if (isInFlightPublishAborted() || isPublishAbortedError(error)) {
      throw isPublishAbortedError(error) ? error : new PublishAbortedError();
    }
    if (isPublicarContextDestroyedError(error)) {
      log("warn", "wallapop_publish_publicar_evaluate_torn_down", {
        message: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
    throw error;
  }
}

function throwIfLandingFailed(
  landing: PublishLandingVerdict,
): asserts landing is Extract<PublishLandingVerdict, { ok: true }> {
  if (landing.ok) return;
  const keepClaim =
    landing.reason === "target_closed" || landing.reason === "unexpected_url";
  throw new WallapopPublishError("form", landing.message, { keepClaim });
}

async function classifyAfterPublicar(
  page: Page,
): Promise<{
  landing: PublishLandingVerdict;
  landingUrl: string | null;
}> {
  const landingRead = await readLandingAfterPublicarClick(page);
  let reviewMessage: string | null = null;
  if (!landingRead.urlReadFailed) {
    reviewMessage = await wallapopUploadReviewMessage(page);
  }
  const landing = classifyPublishLanding({
    url: landingRead.url,
    urlReadFailed: landingRead.urlReadFailed,
    reviewMessage,
  });
  log(landing.ok ? "info" : "warn", "wallapop_publish_verify", {
    reason: landing.reason,
    url: landingRead.url,
  });
  return { landing, landingUrl: landingRead.url };
}

async function resolvePublishedResult(
  page: Page,
  input: PublishWallapopInput,
): Promise<PublishWallapopResult> {
  const { landing, landingUrl } = await classifyAfterPublicar(page);
  throwIfLandingFailed(landing);
  const externalUrl = await resolveItemUrlAfterPublish(page, landing, landingUrl, {
    title: input.title,
    price: input.price,
  });
  log("info", "wallapop_publish_done", {
    step: "published",
    reason: landing.reason,
    externalUrl,
  });
  return { ok: true, dryRun: false, step: "published", externalUrl };
}

async function publishLive(
  page: Page,
  input: PublishWallapopInput,
): Promise<PublishWallapopResult> {
  throwIfPublishAborted();
  const published = await clickFinalPublish(page);
  log("info", "wallapop_publish_publicar_click", { published });
  if (!published) {
    throw new WallapopPublishError(
      "before_publicar",
      "No se pudo hacer click en Publicar.",
    );
  }
  return resolvePublishedResult(page, input);
}

export type FinishPublishArgs = {
  page: Page;
  input: PublishWallapopInput;
  descriptionText: string;
  weightBandLabel: string | null;
  mark: SetPublishStep;
};

/** Pause before Publicar so the operator can check Color/Material. `0` skips. Default 120s. */
function publishHoldMs(): number {
  const raw = process.env.WALLAPOP_PUBLISH_HOLD_MS?.trim();
  if (raw === undefined || raw === "") return 120_000;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function holdBeforePublicar(page: Page): Promise<void> {
  const ms = publishHoldMs();
  if (ms <= 0) return;
  log("info", "wallapop_publish_hold_before_publicar", { ms });
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    throwIfPublishAborted();
    await page.waitForTimeout(Math.min(1_000, deadline - Date.now()));
  }
}

export async function finishPublishOrDryRun(
  args: FinishPublishArgs,
): Promise<PublishWallapopResult> {
  const { page, input, descriptionText, weightBandLabel, mark } = args;
  mark("before_publicar");
  await assertShippingReadyForPublish(page, weightBandLabel);
  await ensureCrmDescriptionOnForm(page, descriptionText, "before_publicar");
  log("info", "wallapop_publish_before_publicar", {
    dryRun: input.dryRun,
    url: page.url(),
    weightBandLabel,
  });
  if (input.dryRun) {
    return {
      ok: true,
      dryRun: true,
      step: "before_publicar",
      externalUrl: null,
    };
  }
  await holdBeforePublicar(page);
  return publishLive(page, input);
}
