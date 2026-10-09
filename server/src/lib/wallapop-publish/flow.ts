import type { Page } from "playwright";

import {
  dismissWallapopConsent,
  firstVisible,
  navigateViaAssign,
  throwIfPublishAborted,
} from "../wallapop-cdp";
import { log } from "../log";
import {
  categoryPickerStillEmpty,
  categorySectionVisible,
} from "./category";
import { logPublishStep, snapshotPublishForm } from "./debug";
import { fillPublishForm } from "./form";
import {
  clickEnabledContinuar,
  clickExactButtonText,
  dismissSearchOverlay,
  readAllVisibleButtonLabels,
  visibleButtonLabels,
} from "./nav";
import { finishPublishOrDryRun } from "./publicar";
import {
  FINAL_RE,
  PUBLISH_SELECTORS,
  UPLOAD_URL,
  WallapopPublishError,
  truncateSummary,
  type PublishWallapopInput,
  type PublishWallapopResult,
  type SetPublishStep,
} from "./types";

export async function gotoUpload(
  page: Page,
  mark: SetPublishStep,
): Promise<void> {
  mark("upload_entry");
  logPublishStep("upload_entry", page, { phase: "goto_upload" });
  await navigateViaAssign(page, UPLOAD_URL);
  await dismissWallapopConsent(page);
  await dismissSearchOverlay(page);
}

export async function selectConsumerGoods(
  page: Page,
  mark: SetPublishStep,
): Promise<void> {
  mark("consumer_goods");
  logPublishStep("consumer_goods", page, { phase: "consumer_goods_check" });
  if (page.url().includes("consumer-goods")) return;
  if (await clickExactButtonText(page, "Algo que ya no necesito")) return;
  const byRole = page.getByRole("button", {
    name: "Algo que ya no necesito",
    exact: true,
  });
  if (await byRole.isVisible().catch(() => false)) {
    await byRole.click({ force: true });
    await page.waitForTimeout(2_500);
    return;
  }
  throw new WallapopPublishError(
    "consumer_goods",
    'No se encontró "Algo que ya no necesito".',
  );
}

export async function fillSummary(
  page: Page,
  input: PublishWallapopInput,
  mark: SetPublishStep,
): Promise<string> {
  mark("summary");
  const summaryText = truncateSummary(input.title);
  logPublishStep("summary", page, { phase: "summary_fill", summaryText });
  const summary = await firstVisible(page, PUBLISH_SELECTORS.summary, 12_000);
  if (!summary) {
    throw new WallapopPublishError(
      "summary",
      "No se encontró el campo Resumen (#summary).",
    );
  }
  await summary.fill(summaryText, { force: true });
  await page.waitForTimeout(500);
  const cont = await clickEnabledContinuar(page);
  logPublishStep("summary", page, { phase: "after_summary_continuar", cont });
  if (cont === "NONE") {
    throw new WallapopPublishError(
      "summary",
      "Continuar deshabilitado tras rellenar el resumen.",
    );
  }
  return summaryText;
}

export async function uploadPhotos(
  page: Page,
  input: PublishWallapopInput,
  mark: SetPublishStep,
): Promise<void> {
  mark("photos");
  const fileInput = page.locator('input[type="file"]').first();
  if (!(await fileInput.count())) {
    throw new WallapopPublishError(
      "photos",
      "No hay input[type=file] para fotos.",
    );
  }
  const paths = input.imagePaths.slice(0, 10);
  await fileInput.setInputFiles(paths);
  log("info", "wallapop_publish_photos_set", { count: paths.length });
  await page.waitForTimeout(8_000);
  const cont = await clickEnabledContinuar(page);
  logPublishStep("photos", page, { phase: "after_photos_continuar", cont });
  if (cont === "NONE") {
    throw new WallapopPublishError(
      "photos",
      "Continuar deshabilitado tras subir las fotos.",
    );
  }
  if (cont === "FINAL") {
    throw new WallapopPublishError(
      "photos",
      "Apareció Publicar demasiado pronto tras las fotos.",
    );
  }
}

async function finalButtonVisible(page: Page): Promise<boolean> {
  const texts = await readAllVisibleButtonLabels(page);
  return texts.some((t) => FINAL_RE.test(t));
}

export async function advanceUntilPublicar(page: Page): Promise<boolean> {
  for (let round = 0; round < 14; round++) {
    throwIfPublishAborted();
    if (await finalButtonVisible(page)) {
      logPublishStep("before_publicar", page, { phase: "publicar_visible", round });
      return true;
    }
    await page.evaluate(`window.scrollBy(0, 350)`);
    const r = await clickEnabledContinuar(page);
    log("info", "wallapop_publish_continuar_round", { round, result: r });
    if (r === "FINAL") return true;
    if (r === "NONE" && round > 4 && (await finalButtonVisible(page))) {
      return true;
    }
  }
  return finalButtonVisible(page);
}

const NO_PUBLICAR_FORM_STATE_EVAL = `(() => ({
      condition: document.querySelector("#condition")?.value || "",
      price: document.querySelector("#price_amount")?.value || "",
      categoryLeaf: document.querySelector("#category_leaf_id")?.value || "",
      delivery: Boolean(document.querySelector("#delivery")?.checked),
      bulky: Boolean(document.querySelector("#bulky")?.checked),
    }))()`;

export async function throwIfPublicarMissing(page: Page): Promise<void> {
  if (await finalButtonVisible(page)) return;
  if (
    (await categorySectionVisible(page)) &&
    (await categoryPickerStillEmpty(page))
  ) {
    throw new WallapopPublishError(
      "form",
      "Categoría no seleccionada; no aparece el botón Publicar.",
    );
  }
  const formState = (await page.evaluate(NO_PUBLICAR_FORM_STATE_EVAL)) as {
    condition: string;
    price: string;
    categoryLeaf: string;
    delivery: boolean;
    bulky: boolean;
  };
  const buttons = await visibleButtonLabels(page);
  log("warn", "wallapop_publish_no_publicar", {
    step: "form",
    visibleButtons: buttons,
    formState,
    ...(await snapshotPublishForm(page)),
  });
  throw new WallapopPublishError(
    "form",
    "No apareció el botón Publicar (dry-run stop).",
  );
}

export async function runPublishAfterAttach(
  input: PublishWallapopInput,
  page: Page,
  setStep: SetPublishStep,
): Promise<PublishWallapopResult> {
  const mark: SetPublishStep = (next) => {
    throwIfPublishAborted();
    setStep(next);
  };
  throwIfPublishAborted();
  await dismissWallapopConsent(page);
  await dismissSearchOverlay(page);
  await gotoUpload(page, mark);
  await selectConsumerGoods(page, mark);
  const summaryText = await fillSummary(page, input, mark);
  await uploadPhotos(page, input, mark);
  const filled = await fillPublishForm(page, input, summaryText, mark);
  const reached = await advanceUntilPublicar(page);
  if (!reached) await throwIfPublicarMissing(page);
  return finishPublishOrDryRun({
    page,
    input,
    titleText: summaryText,
    descriptionText: filled.descriptionText,
    weightBandLabel: filled.weightBandLabel,
    mark,
  });
}
