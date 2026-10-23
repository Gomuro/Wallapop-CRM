import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import type { Page } from "playwright"

import { log } from "../log"

const SNAPSHOT_DIR = path.resolve(process.cwd(), "server", "logs", "sold-debug")
const HTML_MAX_CHARS = 400_000

/** What to look for on a tab with no confirm: where it is, its buttons, whether a modal is open. */
const PAGE_FACTS_EVAL = `(() => ({
  title: document.title,
  buttons: [...document.querySelectorAll("walla-button")].slice(0, 15).map((el) =>
    ((el.id ? "#" + el.id + " " : "") + (el.getAttribute("text") || el.textContent || "").trim()).slice(0, 60)),
  soldModal: Boolean(document.querySelector("tsl-sold-modal")),
  dialog: Boolean(document.querySelector("ngb-modal-window, [role=dialog]")),
  text: (document.body ? document.body.innerText : "").replace(/\\s+/g, " ").trim().slice(0, 300),
}))()`

function firstLine(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? ""
}

function isTest(): boolean {
  return process.env.VITEST === "true" || process.env.NODE_ENV === "test"
}

async function pageFacts(page: Page): Promise<Record<string, unknown>> {
  if (page.isClosed()) return { closed: true }
  try {
    const facts = (await page.evaluate(PAGE_FACTS_EVAL)) as Record<string, unknown>
    return { url: page.url(), ...facts }
  } catch (error) {
    return { url: page.url(), factsError: firstLine(error) }
  }
}

/** Screenshot plus the HTML without scripts, so no session data lands in the file. Overwrites `name`. */
export async function saveSoldSnapshot(
  page: Page,
  name: string,
  dir = SNAPSHOT_DIR,
): Promise<string | null> {
  if (page.isClosed()) return null
  const base = path.join(dir, name)
  try {
    await mkdir(dir, { recursive: true })
    await page.screenshot({ path: `${base}.png`, timeout: 5_000 }).catch(() => {})
    const html = (await page.content()).replace(/<script\b[\s\S]*?<\/script>/gi, "")
    await writeFile(`${base}.html`, html.slice(0, HTML_MAX_CHARS), "utf8")
    return base
  } catch (error) {
    log("warn", "wallapop_sold_snapshot_failed", { message: firstLine(error) })
    return null
  }
}

/** VPS 2026-10-23: three sales stopped at confirm and the log did not say what the tab showed. */
export async function logConfirmMissing(
  page: Page,
  popups: Page[],
  waitedMs: number,
): Promise<void> {
  const facts = await pageFacts(page)
  const snapshot = isTest() ? null : await saveSoldSnapshot(page, "confirm-last")
  log("warn", "wallapop_sold_confirm_missing", {
    waitedMs,
    ...facts,
    popups: popups.map((tab) => (tab.isClosed() ? "closed" : tab.url())),
    snapshot,
  })
}
