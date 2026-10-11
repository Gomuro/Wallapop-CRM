import type { Page } from "playwright"

import { log } from "../log"
import { isClosedPage } from "../wallapop-cdp"
import { clickConfirmEliminar, FIND_ELIMINAR_DIALOG_EVAL } from "./click"
import { WallapopEliminarError } from "./types"

const CONFIRM_WAIT_MS = 8_000
const POLL_MS = 250

async function pageUrls(page: Page): Promise<string[]> {
  const urls: string[] = []
  for (const p of page.context().pages()) {
    if (isClosedPage(p)) continue
    try {
      urls.push(p.url())
    } catch {
      urls.push("(closed)")
    }
  }
  return urls
}

async function dialogOpen(page: Page): Promise<boolean> {
  if (isClosedPage(page)) return false
  try {
    return (await page.evaluate(FIND_ELIMINAR_DIALOG_EVAL)) === "found"
  } catch {
    return false
  }
}

function newestPage(page: Page, before: Set<Page>): Page | null {
  for (const p of page.context().pages()) {
    if (before.has(p) || isClosedPage(p)) continue
    return p
  }
  return null
}

/**
 * Click «Sí, eliminarlo». If another Chrome window steals the dialog (user
 * saw this on the Tomket tyre), follow that tab. Never leave the item while
 * the confirm dialog is still open.
 */
export async function confirmEliminarKeepingPage(page: Page): Promise<Page> {
  await page.bringToFront().catch(() => {})
  const before = new Set(page.context().pages())
  await clickConfirmEliminar(page)

  const deadline = Date.now() + CONFIRM_WAIT_MS
  let extra: Page | null = null
  let extraLogged = false
  while (Date.now() < deadline) {
    extra = newestPage(page, before) ?? extra
    if (extra && !isClosedPage(extra)) {
      if (!extraLogged) {
        extraLogged = true
        log("info", "wallapop_eliminar_extra_window", { url: extra.url() })
      }
      await extra.bringToFront().catch(() => {})
      if (await dialogOpen(extra)) await clickConfirmEliminar(extra)
    }
    const originOpen = await dialogOpen(page)
    const extraOpen = extra ? await dialogOpen(extra) : false
    if (!originOpen && !extraOpen) return extra && !isClosedPage(extra) ? extra : page
    await page.waitForTimeout(POLL_MS)
  }

  await page.bringToFront().catch(() => {})
  if (await dialogOpen(page)) {
    log("info", "wallapop_eliminar_confirm_retry")
    await clickConfirmEliminar(page)
    const retryUntil = Date.now() + 4_000
    while (Date.now() < retryUntil) {
      if (!(await dialogOpen(page))) return page
      await page.waitForTimeout(POLL_MS)
    }
  }

  log("warn", "wallapop_eliminar_confirm_stuck", { urls: await pageUrls(page) })
  throw new WallapopEliminarError(
    "confirm",
    "La confirmación de Eliminar no se cerró. ¿Se abrió otra ventana?",
  )
}
