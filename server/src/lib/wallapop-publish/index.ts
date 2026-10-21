/**
 * Wallapop consumer-goods publish via Chrome CDP.
 * Imports only wallapop-cdp primitives (not login SELECTORS).
 * Research: Desk/.../autopost-research/PUBLISH-FLOW-RESEARCH.md
 */
import type { Page } from "playwright";

import {
  closeWallapopUploadTab,
  consumeKeepChromeAfterAbort,
  ensureWallapopPage,
  isInFlightPublishAborted,
  isPublishAbortedError,
  PublishAbortedError,
  quitChromeIfNoWorkerSlots,
  runWithBrowserBusy,
  setKeepChromeWarm,
} from "../wallapop-cdp";
import { log, serializeError } from "../log";
import { snapshotPublishForm, safePageUrl } from "./debug";
import { runPublishAfterAttach } from "./flow";
import {
  WallapopPublishError,
  type PublishStep,
  type PublishWallapopInput,
  type PublishWallapopResult,
} from "./types";

export type {
  PageUrlReader,
  PublishedCatalogItem,
  PublishLandingReason,
  PublishLandingVerdict,
  PublishStep,
  PublishWallapopInput,
  PublishWallapopResult,
  ShippingPackageType,
} from "./types";
export {
  WallapopPublishError,
  crmTitleMatchesForm,
  normalizePublishTitle,
} from "./types";
export {
  catalogTitleMatchesWanted,
  firstCatalogItemUrl,
  grabCatalogItemUrl,
  parseCatalogPriceEur,
  pickUniqueCatalogItemUrl,
  PRO_CATALOG_ITEMS_EVAL,
  PUBLISHED_CATALOG_ITEMS_EVAL,
  resolveItemUrlAfterPublish,
} from "./catalog-url";
export {
  classifyPublishLanding,
  isPublicarContextDestroyedError,
  isWallapopPublishedCatalogUrl,
  isWallapopUploadFormUrl,
  listingUrlFromPageUrl,
  playwrightClickMessage,
  readLandingAfterPublicarClick,
  readUrlAfterPublicarClick,
} from "./verify";
export { ensureEnvioToggle, envioToggleIsOn } from "./envio";
export {
  ensurePackageSizeIfShown,
  ensureStandardWeightBand,
  roleRadioIsChecked,
} from "./shipping";
export {
  clickMarcaCatalogItem,
  clickMarcaCrearOption,
  queryMarcaCombo,
} from "./dropdown";
export { readBrandValue } from "./marca-combo";

function logPublishStart(input: PublishWallapopInput, page: Page): void {
  log("info", "wallapop_publish_start", {
    title: input.title.slice(0, 80),
    dryRun: input.dryRun,
    photoCount: input.imagePaths.length,
    shippingEnabled: true,
    packageType: input.packageType ?? "STANDARD",
    weightKg: input.weightKg ?? null,
    widthCm: input.widthCm ?? null,
    lengthCm: input.lengthCm ?? null,
    heightCm: input.heightCm ?? null,
    categoryLabels: input.categoryLabels,
    brand: input.brand ?? null,
    url: page.url(),
  });
}

async function rethrowPublishFailure(
  error: unknown,
  step: PublishStep,
  page: Page,
): Promise<never> {
  const failStep = error instanceof WallapopPublishError ? error.step : step;
  if (isPublishAbortedError(error) || isInFlightPublishAborted()) {
    log("info", "wallapop_publish_abort", {
      reason: "stop",
      step: failStep,
      message:
        error instanceof Error ? error.message : "Publicación abortada.",
      url: safePageUrl(page),
    });
    throw isPublishAbortedError(error) ? error : new PublishAbortedError();
  }
  const message = error instanceof Error ? error.message : String(error);
  const clickFailure =
    error instanceof Error &&
    /elementHandle\.click|locator\.click|No se encontró el botón Publicar/i.test(
      message,
    );
  const snap = clickFailure
    ? {}
    : withoutHtmlDump(
        await snapshotPublishForm(
          page,
          /estado|marca|revisa/i.test(message) ? 'id="condition"' : undefined,
        ),
      );
  log("error", "wallapop_publish_abort", {
    step: failStep,
    message,
    unexpected: !(error instanceof WallapopPublishError),
    err: serializeError(error),
    url: safePageUrl(page),
    ...snap,
  });
  throw error;
}

const HTML_DUMP_KEYS = [
  "htmlAround",
  "htmlNeedle",
  "htmlHitLine",
  "htmlFromLine",
  "htmlToLine",
  "htmlTotalLines",
] as const;

function withoutHtmlDump(
  snap: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...snap };
  for (const key of HTML_DUMP_KEYS) delete next[key];
  return next;
}

async function publishWallapopInBrowserAfterAttach(
  input: PublishWallapopInput,
  page: Page,
): Promise<PublishWallapopResult> {
  let step: PublishStep = "attach";
  logPublishStart(input, page);
  try {
    return await runPublishAfterAttach(input, page, (next) => {
      step = next;
    });
  } catch (error) {
    return rethrowPublishFailure(error, step, page);
  }
}

async function publishWallapopInBrowserInner(
  input: PublishWallapopInput,
): Promise<PublishWallapopResult> {
  const page = await ensureWallapopPage(input.cdpPort);
  return publishWallapopInBrowserAfterAttach(input, page);
}

export async function publishWallapopInBrowser(
  input: PublishWallapopInput,
): Promise<PublishWallapopResult> {
  if (!input.imagePaths.length) {
    throw new WallapopPublishError(
      "photos",
      "El producto no tiene fotos en disco.",
    );
  }
  let keepBrowser = false;
  try {
    return await runWithBrowserBusy(
      "publish",
      () => publishWallapopInBrowserInner(input),
      input.cdpPort,
    );
  } catch (error) {
    keepBrowser = error instanceof WallapopPublishError && error.keepBrowser;
    throw error;
  } finally {
    if (input.dryRun) {
      setKeepChromeWarm(true, input.cdpPort);
      log("info", "wallapop_upload_tab_kept_dry_run");
    } else if (consumeKeepChromeAfterAbort(input.cdpPort) || keepBrowser) {
      log("info", "wallapop_chrome_kept_after_abort", {
        dryRun: input.dryRun,
        keepBrowser,
      });
    } else {
      await closeWallapopUploadTab(input.cdpPort);
      await quitChromeIfNoWorkerSlots(input.cdpPort);
    }
  }
}
