import { randomUUID } from "node:crypto"

import { chromium, type Page } from "playwright"

import {
  fingerprintUploadFields,
  parseUploadComponents,
  type CategoryUploadField,
} from "../../lib/inventory/category-upload-fields"
import { wallapopSessionHeaders } from "./wallapop-brand-options"

export const UPLOAD_COMPONENTS_URL =
  "https://api.wallapop.com/api/v3/items/upload/components"

export type UploadFieldsCatalog = {
  fingerprint: string
  fields: CategoryUploadField[]
  leafWallapopIds: number[]
}

export type UploadFieldsSnapshot = {
  fetchedAt: string
  catalogs: UploadFieldsCatalog[]
}

export function uploadComponentsBody(
  leafWallapopId: number,
  rootCategoryId: string,
  summary: string,
) {
  return {
    fields: {
      summary,
      category_leaf_id: String(leafWallapopId),
      root_category_id: rootCategoryId,
    },
    mode: { action: "upload" as const, id: randomUUID() },
  }
}

export async function postUploadComponents(
  bearer: string,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  const response = await fetch(UPLOAD_COMPONENTS_URL, {
    method: "POST",
    headers: {
      ...wallapopSessionHeaders(bearer),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let json: unknown = text
  try {
    json = JSON.parse(text)
  } catch {
    // keep text
  }
  return { status: response.status, json }
}

export function catalogFromPayload(
  payload: unknown,
  leafWallapopId: number,
): UploadFieldsCatalog {
  const fields = parseUploadComponents(payload)
  return {
    fingerprint: fingerprintUploadFields(fields),
    fields,
    leafWallapopIds: [leafWallapopId],
  }
}

function bearerFromHeader(value: string | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  const token = trimmed.replace(/^Bearer\s+/i, "")
  if (token.startsWith("eyJ") && token.split(".").length >= 3) return token
  return null
}

async function captureBearerFromNetwork(page: Page): Promise<string | null> {
  let captured: string | null = null
  const onRequest = (req: {
    url: () => string
    headers: () => Record<string, string>
  }) => {
    if (captured) return
    if (!req.url().includes("api.wallapop.com")) return
    captured = bearerFromHeader(req.headers().authorization)
  }
  page.on("request", onRequest)
  try {
    await page.evaluate(
      `location.assign(${JSON.stringify("https://es.wallapop.com/app/catalog/upload")})`,
    )
    const deadline = Date.now() + 20_000
    while (!captured && Date.now() < deadline) {
      await page.waitForTimeout(250)
    }
    return captured
  } finally {
    page.off("request", onRequest)
  }
}

/** One Bearer for the whole fetch. Do not quit chrome.exe. */
export async function resolveUploadComponentsBearer(): Promise<string> {
  const fromEnv = process.env.WALLAPOP_BEARER?.trim() ?? ""
  const cdpUrl = process.env.WALLAPOP_CDP_URL?.trim() || "http://127.0.0.1:9222"
  const browser = await chromium.connectOverCDP(cdpUrl)
  let page = browser
    .contexts()
    .flatMap((ctx) => ctx.pages())
    .find((p) => p.url().includes("es.wallapop.com"))
  if (!page) {
    const ctx = browser.contexts()[0]
    if (!ctx) throw new Error("Chrome CDP has no browser context.")
    page = await ctx.newPage()
    await page.goto("https://es.wallapop.com/wall", {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    })
  }
  const captured = await captureBearerFromNetwork(page)
  const bearer = captured || fromEnv
  if (!bearer) {
    throw new Error(
      "No Wallapop Bearer. Open upload in Chrome CDP or set WALLAPOP_BEARER.",
    )
  }
  return bearer
}
