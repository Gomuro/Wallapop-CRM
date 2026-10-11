import type { Page } from "playwright"

import { isClosedPage } from "./attach"
import type { BrowserWorkerSlot } from "./busy"

const workerPages: Partial<Record<BrowserWorkerSlot, Page>> = {}
const soldJobPages: Page[] = []

export function listOwnedWorkerPages(): Page[] {
  const owned: Page[] = []
  for (const page of Object.values(workerPages)) {
    if (page && !isClosedPage(page)) owned.push(page)
  }
  for (const page of soldJobPages) {
    if (!isClosedPage(page)) owned.push(page)
  }
  return owned
}

export function isOwnedWorkerPage(page: Page): boolean {
  return listOwnedWorkerPages().includes(page)
}

export function peekWorkerPage(slot: BrowserWorkerSlot): Page | null {
  return workerPages[slot] ?? null
}

export function getWorkerPage(slot: BrowserWorkerSlot): Page | null {
  const page = workerPages[slot]
  if (!page || isClosedPage(page)) return null
  return page
}

export function setWorkerPage(slot: BrowserWorkerSlot, page: Page): void {
  workerPages[slot] = page
}

export function clearWorkerPage(slot: BrowserWorkerSlot): void {
  delete workerPages[slot]
}

export function registerSoldJobPage(page: Page): void {
  soldJobPages.push(page)
}

export function takeSoldJobPages(): Page[] {
  const pages = [...soldJobPages]
  soldJobPages.length = 0
  const sold = workerPages.sold
  clearWorkerPage("sold")
  if (sold) pages.push(sold)
  return pages
}
