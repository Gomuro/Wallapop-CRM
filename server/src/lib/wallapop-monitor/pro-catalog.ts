import type { Page } from "playwright"

import { PAGE_KIND_EVAL } from "./pro-catalog-eval"

export { parseProPager, PRO_CATALOG_ROWS_EVAL } from "./pro-catalog-eval"
export { ensureTodoElCatalogo } from "./pro-catalog-choice"
export { scrapeProActivos, scrapeProCatalogs, waitForActivosHrefs } from "./pro-catalog-pages"
export type { ProActivosSnapshot } from "./pro-catalog-pages"

export async function wallapopCatalogKind(
  page: Page,
): Promise<"pro" | "classic" | "unknown"> {
  await page
    .waitForFunction(
      `Boolean(
        document.querySelector("wallapop-tab[aria-label^='Activos']") ||
        document.querySelector("tsl-catalog-item")
      )`,
      { timeout: 20_000 },
    )
    .catch(() => {})
  const kind = (await page.evaluate(PAGE_KIND_EVAL)) as string
  if (kind === "pro" || kind === "classic") return kind
  return "unknown"
}
