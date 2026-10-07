import { spawn } from "node:child_process"
import { createWriteStream } from "node:fs"
import { stat, unlink } from "node:fs/promises"
import path from "node:path"

import {
  backupForDay,
  backupStamp,
  ensureBackupDir,
  listBackupFiles,
  rotateBackupFiles,
  type BackupFileMeta,
} from "./backup-files"

export type CreateBackupResult = {
  file: BackupFileMeta
  reused: boolean
}

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) throw new Error("DATABASE_URL is missing.")
  return url
}

function failFrom(command: string, code: number | null, err: string): Error {
  return new Error(err.trim() || `${command} exited ${code}`)
}

function spawnOnce(
  command: string,
  args: string[],
  options: { outFile?: string },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", options.outFile ? "pipe" : "ignore", "pipe"],
    })
    const out = options.outFile ? createWriteStream(options.outFile) : null
    if (out && child.stdout) child.stdout.pipe(out)
    let err = ""
    child.stderr?.on("data", (chunk: Buffer) => {
      err += chunk.toString()
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (!out) {
        if (code === 0) resolve()
        else reject(failFrom(command, code, err))
        return
      }
      out.end()
      out.on("close", () => {
        if (code === 0) resolve()
        else reject(failFrom(command, code, err))
      })
    })
  })
}

function pgDumpUrl(databaseUrl: string): string {
  const parsed = new URL(databaseUrl)
  parsed.search = ""
  return parsed.toString()
}

async function dumpWithPgDump(file: string, databaseUrl: string): Promise<void> {
  const bin = process.env.PG_DUMP?.trim() || "pg_dump"
  await spawnOnce(bin, ["-Fc", "-f", file, pgDumpUrl(databaseUrl)], {})
}

async function dumpWithDocker(file: string): Promise<void> {
  const container = process.env.BACKUP_DOCKER_CONTAINER?.trim() || "wallapop-crm-db"
  await spawnOnce(
    "docker",
    ["exec", container, "pg_dump", "-U", "wallapop", "-Fc", "wallapop_crm"],
    { outFile: file },
  )
}

async function runDump(file: string): Promise<void> {
  if (process.env.BACKUP_VIA_DOCKER?.trim() === "true") {
    await dumpWithDocker(file)
    return
  }
  try {
    await dumpWithPgDump(file, requireDatabaseUrl())
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? err.code : ""
    if (code !== "ENOENT") throw err
    await dumpWithDocker(file)
  }
}

export async function createBackup(): Promise<CreateBackupResult> {
  const existing = await listBackupFiles()
  const today = backupForDay(existing)
  if (today) return { file: today, reused: true }
  const dir = await ensureBackupDir()
  const name = `wallapop_crm-${backupStamp()}.pgdump`
  const file = path.join(dir, name)
  try {
    await runDump(file)
    const info = await stat(file)
    if (info.size === 0) throw new Error("pg_dump wrote an empty file.")
  } catch (err) {
    await unlink(file).catch(() => {})
    throw err
  }
  await rotateBackupFiles()
  const rows = await listBackupFiles()
  const created = rows.find((row) => row.file === name)
  if (!created) throw new Error("Backup file missing after pg_dump.")
  return { file: created, reused: false }
}
