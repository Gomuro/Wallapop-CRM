import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs"
import path from "node:path"

const LOG_DIR = path.resolve(process.cwd(), "server", "logs")
const LOG_FILE = path.join(LOG_DIR, "server.log")
const PREV_FILE = path.join(LOG_DIR, "server.prev.log")
const MAX_BYTES = 5 * 1024 * 1024

export type LogLevel = "info" | "warn" | "error"

function isTest() {
  return process.env.VITEST === "true" || process.env.NODE_ENV === "test"
}

export function serializeError(err: unknown) {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack }
  }
  return { message: String(err) }
}

function rotateIfNeeded() {
  try {
    if (statSync(LOG_FILE).size < MAX_BYTES) return
    try {
      renameSync(LOG_FILE, PREV_FILE)
    } catch {
      // previous file may be locked on Windows; keep appending
    }
  } catch {
    // file does not exist yet
  }
}

function writeFile(line: string) {
  if (isTest()) return
  try {
    mkdirSync(LOG_DIR, { recursive: true })
    rotateIfNeeded()
    appendFileSync(LOG_FILE, `${line}\n`, "utf8")
  } catch {
    // logging must never take the API down
  }
}

export function log(
  level: LogLevel,
  msg: string,
  extra?: Record<string, unknown>,
) {
  const line = JSON.stringify({
    t: new Date().toISOString(),
    level,
    msg,
    ...extra,
  })
  if (!isTest() || level === "error") {
    const stream = level === "info" ? process.stdout : process.stderr
    stream.write(`${line}\n`)
  }
  writeFile(line)
}
