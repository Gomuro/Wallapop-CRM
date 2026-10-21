import type { Page } from "playwright";

import {
  isInFlightPublishAborted,
  isPublishAbortedError,
  PublishAbortedError,
  throwIfPublishAborted,
} from "../wallapop-cdp";
import { log } from "../log";
import {
  ensureCrmDescriptionOnForm,
  ensureCrmTitleOnForm,
} from "./fields";
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
  playwrightClickMessage,
  readLandingAfterPublicarClick,
  wallapopUploadReviewMessage,
} from "./verify";

const FINAL_PUBLISH_ELEMENT_JS = `(() => {
    const re = new RegExp(${JSON.stringify(FINAL_RE.source)}, ${JSON.stringify(FINAL_RE.flags)});
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
      if (!re.test(labelOf(el))) continue;
      const target = el.shadowRoot?.querySelector?.("button") || el;
      const r = target.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      target.scrollIntoView({ block: "center", inline: "nearest" });
      return target;
    }
    return null;
  })()`;

function clickLeftTheButton(error: unknown): boolean {
  if (isPublicarContextDestroyedError(error)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /not attached to the DOM|element was detached|frame was detached/i.test(
    message,
  );
}

async function clickFinalPublish(page: Page): Promise<void> {
  throwIfPublishAborted();
  const handle = await page.evaluateHandle(FINAL_PUBLISH_ELEMENT_JS);
  const element = handle.asElement();
  if (!element) {
    await handle.dispose();
    throw new WallapopPublishError(
      "before_publicar",
      "No se encontró el botón Publicar.",
    );
  }
  try {
    await element.click({ timeout: 8_000 });
  } catch (error) {
    if (isInFlightPublishAborted() || isPublishAbortedError(error)) {
      throw isPublishAbortedError(error) ? error : new PublishAbortedError();
    }
    if (clickLeftTheButton(error)) {
      log("warn", "wallapop_publish_publicar_evaluate_torn_down", {
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    throw new WallapopPublishError(
      "before_publicar",
      playwrightClickMessage(error),
    );
  } finally {
    await element.dispose().catch(() => {});
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
  await clickFinalPublish(page);
  log("info", "wallapop_publish_publicar_click", { published: true });
  return resolvePublishedResult(page, input);
}

export type FinishPublishArgs = {
  page: Page;
  input: PublishWallapopInput;
  titleText: string;
  descriptionText: string;
  weightBandLabel: string | null;
  mark: SetPublishStep;
};

export async function finishPublishOrDryRun(
  args: FinishPublishArgs,
): Promise<PublishWallapopResult> {
  const { page, input, titleText, descriptionText, weightBandLabel, mark } =
    args;
  mark("before_publicar");
  await assertShippingReadyForPublish(page, weightBandLabel);
  await ensureCrmTitleOnForm(page, titleText, "before_publicar");
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
  return publishLive(page, input);
}
