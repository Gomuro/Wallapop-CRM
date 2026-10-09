import type { CategoryUploadField } from "../../../../lib/inventory/category-upload-fields";

export const UPLOAD_URL = "https://es.wallapop.com/app/catalog/upload";
export const SUMMARY_MAX = 50;
export const PUBLICAR_SETTLE_MS = 5_000;

export const FINAL_RE =
  /^(Publicar|Publicar anuncio|Crear producto|Subir anuncio|Subir producto|Опублікувати|Пост|Publish|Post)$/i;

export const ESTADO_BY_CONDITION: Record<string, string> = {
  NEW: "Nuevo",
  AS_GOOD_AS_NEW: "Como nuevo",
  GOOD: "En buen estado",
  FAIR: "En condiciones aceptables",
  HAS_GIVEN_IT_ALL: "Lo ha dado todo",
};

/**
 * Category picker (UploadCategoriesSelector): `walla-dropdown` → floating `[role=listbox]`
 * with `walla-dropdown-item[role=option][aria-label="…"]` (Categorías sugeridas + Todas).
 */
export const PUBLISH_CATEGORY = {
  sectionHeading: /Selecciona una categoría/i,
  triggerText: "Categoría y subcategoría",
  comboboxName: /categoría/i,
  dropdownTag: "walla-dropdown",
  listboxRole: "listbox",
  optionTag: "walla-dropdown-item",
} as const;

export const PUBLISH_SELECTORS = {
  summary: ["#summary", 'input[name="summary"]'],
  price: [
    'input[name="price_amount"]',
    "#price_amount",
    'input[name="price"]',
    "#price",
    'input[placeholder*="Precio" i]',
    'input[aria-label*="Precio" i]',
  ],
  title: [
    'input[name="title"]',
    "#title",
    'input[aria-label*="Título" i]',
    'input[placeholder*="Título" i]',
  ],
  description: [
    'textarea[name="description"]',
    "#description",
    'textarea[aria-label*="Descripción" i]',
  ],
} as const;

export type PublishStep =
  | "attach"
  | "upload_entry"
  | "consumer_goods"
  | "summary"
  | "photos"
  | "form"
  | "before_publicar"
  | "published";

export type SetPublishStep = (step: PublishStep) => void;

export type ShippingPackageType = "STANDARD" | "BULKY";

export type PublishWallapopInput = {
  title: string;
  description: string;
  price: number;
  condition: string;
  brand?: string | null;
  imagePaths: string[];
  /** Spanish breadcrumb root → leaf from CRM `Category.path`. */
  categoryLabels: string[];
  dryRun: boolean;
  shippingEnabled?: boolean;
  packageType?: ShippingPackageType;
  weightKg?: number | null;
  widthCm?: number | null;
  lengthCm?: number | null;
  heightCm?: number | null;
  typeAttributes?: unknown;
  uploadFields?: CategoryUploadField[];
};

export type PublishWallapopResult = {
  ok: true;
  dryRun: boolean;
  step: PublishStep;
  externalUrl?: string | null;
};

export class WallapopPublishError extends Error {
  step: PublishStep;
  /** True: Publicar may have run; keep POSTING, do not write ACTIVE. */
  keepClaim: boolean;
  constructor(
    step: PublishStep,
    message: string,
    opts?: { keepClaim?: boolean },
  ) {
    super(message);
    this.name = "WallapopPublishError";
    this.step = step;
    this.keepClaim = opts?.keepClaim === true;
  }
}

export type PageUrlReader = {
  url: () => string;
  waitForTimeout: (ms: number) => Promise<void>;
};

export type PublishedCatalogItem = {
  title: string;
  href: string;
  priceText: string;
};

export type PublishLandingReason =
  | "published_catalog"
  | "item_url"
  | "still_on_upload"
  | "review_banner"
  | "target_closed"
  | "unexpected_url";

export type PublishLandingVerdict =
  | { ok: true; reason: "published_catalog" | "item_url" }
  | {
      ok: false;
      reason:
        | "still_on_upload"
        | "review_banner"
        | "target_closed"
        | "unexpected_url";
      message: string;
    };

export function normalizePublishTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ");
}

export function crmTitleMatchesForm(
  actual: string,
  expected: string,
): boolean {
  const want = normalizePublishTitle(expected);
  if (!want) return true;
  return normalizePublishTitle(actual) === want;
}

export function truncateSummary(title: string): string {
  const trimmed = normalizePublishTitle(title);
  if (trimmed.length <= SUMMARY_MAX) return trimmed;
  return trimmed.slice(0, SUMMARY_MAX);
}

export function estadoLabel(condition: string): string {
  return ESTADO_BY_CONDITION[condition] ?? "Como nuevo";
}
