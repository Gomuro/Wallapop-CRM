/**
 * One-off probe: POST /api/v3/items/upload/components for a category leaf.
 * Auth: WALLAPOP_BEARER in server/.env, or logged-in es.wallapop.com on CDP (9222).
 *
 *   npx tsx server/prisma/probe-upload-components.ts
 *   npx tsx server/prisma/probe-upload-components.ts 24250
 */
import "../load-env"
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { chromium, type Page } from "playwright"

import {
  flattenWallapopCategories,
  type FlatCategory,
} from "./flatten-wallapop-categories"
import { wallapopSessionHeaders } from "./wallapop-brand-options"

const UPLOAD_COMPONENTS_URL =
  "https://api.wallapop.com/api/v3/items/upload/components"

const CATEGORIES_SNAPSHOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "data",
  "wallapop-categories.json",
)

function rootCategoryId(row: FlatCategory): string {
  const first = row.path.split("/").filter(Boolean)[0]
  if (!first) throw new Error(`No root in path for leaf ${row.wallapopId}`)
  return first
}

function loadLeaf(wallapopLeafId: number): FlatCategory {
  const raw = JSON.parse(readFileSync(CATEGORIES_SNAPSHOT, "utf8")) as {
    categories?: unknown
  }
  const rows = flattenWallapopCategories(raw)
  const row = rows.find((r) => r.wallapopId === wallapopLeafId)
  if (!row?.isLeaf) {
    throw new Error(`Leaf wallapop_id=${wallapopLeafId} not found in snapshot`)
  }
  return row
}

function buildBody(leaf: FlatCategory, summary: string) {
  return {
    fields: {
      summary,
      category_leaf_id: String(leaf.wallapopId),
      root_category_id: rootCategoryId(leaf),
    },
    mode: { action: "upload", id: randomUUID() },
  }
}

function parseJsonBody(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
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
  const onRequest = (req: { url: () => string; headers: () => Record<string, string> }) => {
    if (captured) return
    if (!req.url().includes("api.wallapop.com")) return
    captured = bearerFromHeader(req.headers().authorization)
  }
  page.on("request", onRequest)
  try {
    await page.evaluate(`location.assign(${JSON.stringify("https://es.wallapop.com/app/catalog/upload")})`)
    const deadline = Date.now() + 20_000
    while (!captured && Date.now() < deadline) {
      await page.waitForTimeout(250)
    }
    return captured
  } finally {
    page.off("request", onRequest)
  }
}

async function postWithBearer(
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
  return { status: response.status, json: parseJsonBody(text) }
}

async function postJson(body: unknown): Promise<{
  status: number
  json: unknown
}> {
  const fromEnv = process.env.WALLAPOP_BEARER?.trim() ?? ""
  const cdpUrl = process.env.WALLAPOP_CDP_URL?.trim() || "http://127.0.0.1:9222"
  const browser = await chromium.connectOverCDP(cdpUrl)
  try {
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
      return {
        status: 401,
        json: { code: "NO_BEARER", hint: "No Authorization on CDP traffic." },
      }
    }
    console.log("auth:", captured ? "cdp_network" : "env")
    return postWithBearer(bearer, body)
  } finally {
    // CDP attach — do not quit chrome.exe
  }
}

type ComponentRow = {
  id?: string
  type?: string
  label?: string
  required?: boolean
  testId?: string
  name?: string
}

function summarizeComponents(json: unknown): void {
  if (!json || typeof json !== "object") {
    console.log("response is not an object")
    return
  }
  const record = json as Record<string, unknown>
  const components = record.components
  if (!Array.isArray(components)) {
    console.log("top-level keys:", Object.keys(record).join(", "))
    return
  }
  console.log(`components: ${components.length}`)
  for (const item of components) {
    if (!item || typeof item !== "object") continue
    const c = item as ComponentRow & Record<string, unknown>
    const label =
      typeof c.label === "string"
        ? c.label
        : typeof c.name === "string"
          ? c.name
          : "?"
    const type = typeof c.type === "string" ? c.type : "?"
    const id = typeof c.id === "string" ? c.id : c.testId ?? "?"
    const req = c.required === true ? "*" : ""
    console.log(`  - ${label}${req}  type=${type}  id=${id}`)
    const options = c.options ?? c.values ?? c.items
    if (Array.isArray(options) && options.length > 0) {
      const sample = options
        .slice(0, 5)
        .map((o) => {
          if (!o || typeof o !== "object") return String(o)
          const row = o as { title?: string; label?: string; id?: string }
          return row.title ?? row.label ?? row.id ?? "?"
        })
      console.log(
        `      options(${options.length}): ${sample.join(", ")}${options.length > 5 ? "…" : ""}`,
      )
    }
  }
}

async function main() {
  const leafArg = process.argv[2]?.trim()
  const leafId = leafArg ? Number(leafArg) : 24250
  if (!Number.isFinite(leafId)) {
    throw new Error(`Invalid leaf id: ${leafArg}`)
  }

  const leaf = loadLeaf(leafId)
  const summary = `Probe CRM leaf ${leaf.nameEs}`
  const body = buildBody(leaf, summary)

  console.log("POST", UPLOAD_COMPONENTS_URL)
  console.log("leaf:", leaf.wallapopId, leaf.nameEs, "path:", leaf.path)
  console.log("body.fields:", JSON.stringify(body.fields))

  const { status, json } = await postJson(body)
  console.log("HTTP", status)
  if (status < 200 || status >= 300) {
    console.log(JSON.stringify(json, null, 2).slice(0, 4000))
    if (status === 401) {
      console.error(
        "401: set WALLAPOP_BEARER in server/.env (copy Bearer from DevTools on upload), or log in on Chrome CDP profile.",
      )
    }
    process.exit(1)
  }

  summarizeComponents(json)
  const outPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "data",
    `upload-components-probe-${leafId}.json`,
  )
  const { writeFileSync, mkdirSync } = await import("node:fs")
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(json, null, 2)}\n`, "utf8")
  console.log("wrote", outPath)
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
