import type { Page } from "playwright";

import { log } from "../log";
import { ensureCategorySelected } from "./category";
import { logPublishStep } from "./debug";
import { closeOpenDropdowns } from "./dropdown";
import { ensureEnvioToggle } from "./envio";
import {
  ensureEstado,
  fillPrice,
  fillPublishDescription,
  fillPublishTitle,
  readPriceAmount,
} from "./fields";
import { ensureExtraUploadFields } from "./extra-fields";
import { ensureMarcaIfShown } from "./marca";
import { clickMainText } from "./nav";
import {
  ensurePackageSizeIfShown,
  ensureStandardWeightBand,
  fillMeasuresIfPresent,
  isStandardWeightBandSelected,
  roleRadioIsChecked,
} from "./shipping";
import {
  estadoLabel,
  type PublishWallapopInput,
  type SetPublishStep,
} from "./types";

async function fillCoreFormFields(
  page: Page,
  input: PublishWallapopInput,
  summaryText: string,
): Promise<string> {
  const descriptionText = input.description?.trim() || summaryText;
  await fillPublishTitle(page, summaryText);
  await fillPublishDescription(page, descriptionText);
  logPublishStep("form", page, { phase: "after_title_description" });
  await ensureEstado(page, estadoLabel(input.condition));
  await fillPrice(page, input.price);
  logPublishStep("form", page, { phase: "after_estado_price" });
  await ensureMarcaIfShown(page, input.brand);
  await ensureExtraUploadFields(
    page,
    input.uploadFields ?? [],
    input.typeAttributes,
  );
  return descriptionText;
}

async function fillShippingSection(
  page: Page,
  input: PublishWallapopInput,
): Promise<string | null> {
  const packageType = input.packageType ?? "STANDARD";
  await page.evaluate(`window.scrollBy(0, 500)`).catch(() => {});
  await ensureEnvioToggle(page, true);
  await ensurePackageSizeIfShown(page, packageType);
  if (packageType === "STANDARD" && input.weightKg != null) {
    const weightBandLabel = await ensureStandardWeightBand(
      page,
      input.weightKg,
    );
    logPublishStep("form", page, {
      phase: "after_weight",
      weightKg: input.weightKg,
      weightBandLabel,
    });
    return weightBandLabel;
  }
  log("info", "wallapop_publish_weight_skip", {
    packageType,
    weightKg: input.weightKg ?? null,
    reason:
      packageType !== "STANDARD" ? "package_not_standard" : "no_weight_kg_in_crm",
  });
  return null;
}

async function logFormBeforeContinuar(
  page: Page,
  input: PublishWallapopInput,
  weightBandLabel: string | null,
): Promise<void> {
  const packageType = input.packageType ?? "STANDARD";
  logPublishStep("form", page, {
    phase: "form_before_continuar_loop",
    price: await readPriceAmount(page),
    condition: await page
      .locator("#condition")
      .inputValue()
      .catch(() => ""),
    packageType,
    weightKg: input.weightKg ?? null,
    weightBandLabel,
    weightBandSelected: weightBandLabel
      ? await isStandardWeightBandSelected(page, weightBandLabel)
      : false,
    delivery: await roleRadioIsChecked(page, "delivery"),
    bulky: await roleRadioIsChecked(page, "bulky"),
  });
}

export async function fillPublishForm(
  page: Page,
  input: PublishWallapopInput,
  summaryText: string,
  mark: SetPublishStep,
): Promise<{ descriptionText: string; weightBandLabel: string | null }> {
  mark("form");
  logPublishStep("form", page, { phase: "form_start" });
  await ensureCategorySelected(page, input.categoryLabels);
  await closeOpenDropdowns(page);
  logPublishStep("form", page, { phase: "after_category" });
  const descriptionText = await fillCoreFormFields(page, input, summaryText);
  const weightBandLabel = await fillShippingSection(page, input);
  await fillMeasuresIfPresent(
    page,
    input.widthCm,
    input.lengthCm,
    input.heightCm,
  );
  await clickMainText(page, "No lo es");
  if (!(await readPriceAmount(page))) {
    await fillPrice(page, input.price);
  }
  await logFormBeforeContinuar(page, input, weightBandLabel);
  return { descriptionText, weightBandLabel };
}
