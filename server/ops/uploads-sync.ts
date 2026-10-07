import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  isSafeStorageKey,
  uniqueStorageKeys,
  UPLOAD_DIR,
} from "../../lib/uploads/config"

import { opsUploadOrigin } from "./env"

export type UploadSyncReport = {
  copied: string[]
  skipped: string[]
  missing: string[]
  failed: { key: string; reason: string }[]
}

const COPY_CONCURRENCY = 6

export function localUploadDir(): string {
  return path.resolve(process.cwd(), UPLOAD_DIR)
}

export function emptyUploadSyncReport(): UploadSyncReport {
  return { copied: [], skipped: [], missing: [], failed: [] }
}

async function fileSize(filePath: string): Promise<number | null> {
  try {
    const meta = await stat(filePath)
    return meta.isFile() ? meta.size : null
  } catch {
    return null
  }
}

function cookieHeader(res: Response): string {
  const bags =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : []
  return bags.map((row) => row.split(";")[0] ?? "").filter(Boolean).join("; ")
}

export async function loginOpsOrigin(): Promise<string> {
  const email = process.env.SEED_USER_EMAIL?.trim()
  const password = process.env.SEED_USER_PASSWORD?.trim()
  if (!email || !password) {
    throw new Error("SEED_USER_EMAIL / SEED_USER_PASSWORD needed to push photos.")
  }
  const res = await fetch(`${opsUploadOrigin()}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    throw new Error(`VPS login failed (${res.status}) while pushing photos.`)
  }
  const cookie = cookieHeader(res)
  if (!cookie) throw new Error("VPS login did not return a session cookie.")
  return cookie
}

async function pullOne(
  origin: string,
  dir: string,
  key: string,
  dryRun: boolean,
): Promise<"copied" | "skipped" | "missing"> {
  const dest = path.join(dir, key)
  const existing = await fileSize(dest)
  if (existing && existing > 0) return "skipped"
  if (dryRun) return "copied"
  const res = await fetch(`${origin}/uploads/${encodeURIComponent(key)}`)
  if (res.status === 404) return "missing"
  if (!res.ok) {
    throw new Error(`GET /uploads/${key} → ${res.status}`)
  }
  await mkdir(dir, { recursive: true })
  await writeFile(dest, Buffer.from(await res.arrayBuffer()))
  return "copied"
}

async function pushOne(
  origin: string,
  cookie: string,
  dir: string,
  key: string,
  dryRun: boolean,
): Promise<"copied" | "skipped" | "missing"> {
  const src = path.join(dir, key)
  if ((await fileSize(src)) == null) return "missing"
  const remote = await fetch(`${origin}/uploads/${encodeURIComponent(key)}`, {
    method: "HEAD",
  })
  if (remote.ok) return "skipped"
  if (dryRun) return "copied"
  const file = new File([new Uint8Array(await readFile(src))], key)
  const body = new FormData()
  body.append("file", file, key)
  const res = await fetch(
    `${origin}/api/v1/ops/uploads/${encodeURIComponent(key)}`,
    { method: "PUT", headers: { cookie }, body },
  )
  if (!res.ok) {
    throw new Error(`PUT /ops/uploads/${key} → ${res.status}`)
  }
  return "copied"
}

async function mapKeys(
  keys: string[],
  each: (key: string) => Promise<"copied" | "skipped" | "missing">,
): Promise<UploadSyncReport> {
  const report = emptyUploadSyncReport()
  const queue = uniqueStorageKeys(keys)
  let index = 0
  async function worker() {
    while (index < queue.length) {
      const key = queue[index]
      index += 1
      if (!key || !isSafeStorageKey(key)) continue
      try {
        report[await each(key)].push(key)
      } catch (error) {
        report.failed.push({
          key,
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
  await Promise.all(
    Array.from({ length: COPY_CONCURRENCY }, () => worker()),
  )
  return report
}

export async function pullUploadFiles(
  keys: string[],
  dryRun: boolean,
): Promise<UploadSyncReport> {
  const origin = opsUploadOrigin()
  const dir = localUploadDir()
  return mapKeys(keys, (key) => pullOne(origin, dir, key, dryRun))
}

export async function pushUploadFiles(
  keys: string[],
  dryRun: boolean,
): Promise<UploadSyncReport> {
  const origin = opsUploadOrigin()
  const dir = localUploadDir()
  const cookie = dryRun ? "" : await loginOpsOrigin()
  return mapKeys(keys, (key) => pushOne(origin, cookie, dir, key, dryRun))
}
