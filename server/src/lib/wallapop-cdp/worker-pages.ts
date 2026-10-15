import type { Page } from "playwright"

import { firstCdpPort } from "../../../../lib/accounts/chrome-place"
import { isClosedPage } from "./attach"
import type { BrowserWorkerSlot } from "./busy"

const workerPages = new Map<string, Page>()
const soldJobPages = new Map<number, Page[]>()

function slotKey(slot: BrowserWorkerSlot, port = firstCdpPort()): string {
  return `${port}:${slot}`
}

function pagesForPort(port: number): Page[] {
  const owned: Page[] = []
  for (const [key, page] of workerPages) {
    if (!key.startsWith(`${port}:`)) continue
    if (page && !isClosedPage(page)) owned.push(page)
  }
  for (const page of soldJobPages.get(port) ?? []) {
    if (!isClosedPage(page)) owned.push(page)
  }
  return owned
}

export function listOwnedWorkerPages(port = firstCdpPort()): Page[] {
  return pagesForPort(port)
}

export function isOwnedWorkerPage(page: Page): boolean {
  for (const owned of workerPages.values()) {
    if (owned === page && !isClosedPage(owned)) return true
  }
  for (const pages of soldJobPages.values()) {
    if (pages.includes(page) && !isClosedPage(page)) return true
  }
  return false
}

export function peekWorkerPage(
  slot: BrowserWorkerSlot,
  port = firstCdpPort(),
): Page | null {
  return workerPages.get(slotKey(slot, port)) ?? null
}

export function getWorkerPage(
  slot: BrowserWorkerSlot,
  port = firstCdpPort(),
): Page | null {
  const page = peekWorkerPage(slot, port)
  if (!page || isClosedPage(page)) return null
  return page
}

export function setWorkerPage(
  slot: BrowserWorkerSlot,
  page: Page,
  port = firstCdpPort(),
): void {
  workerPages.set(slotKey(slot, port), page)
}

export function clearWorkerPage(
  slot: BrowserWorkerSlot,
  port = firstCdpPort(),
): void {
  workerPages.delete(slotKey(slot, port))
}

export function registerSoldJobPage(page: Page, port = firstCdpPort()): void {
  const pages = soldJobPages.get(port) ?? []
  pages.push(page)
  soldJobPages.set(port, pages)
}

export function takeSoldJobPages(port = firstCdpPort()): Page[] {
  const pages = [...(soldJobPages.get(port) ?? [])]
  soldJobPages.delete(port)
  const sold = peekWorkerPage("sold", port)
  clearWorkerPage("sold", port)
  if (sold) pages.push(sold)
  return pages
}
