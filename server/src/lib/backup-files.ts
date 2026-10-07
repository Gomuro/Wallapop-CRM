import { mkdir, readdir, stat, unlink } from "node:fs/promises"
import path from "node:path"

export const BACKUP_KEEP = 7
export const BACKUP_NAME_RE = /^wallapop_crm-\d{8}-\d{4}\.pgdump$/

export type BackupFileMeta = {
  file: string
  size: number
  mtime: string
}

export function backupDir(): string {
  const fromEnv = process.env.BACKUP_DIR?.trim()
  if (fromEnv) return path.resolve(fromEnv)
  return path.resolve(process.cwd(), "backups")
}

export function isSafeBackupName(file: string): boolean {
  return BACKUP_NAME_RE.test(file)
}

export function resolveBackupPath(file: string): string | null {
  if (!isSafeBackupName(file)) return null
  const dir = backupDir()
  const abs = path.resolve(dir, file)
  if (!abs.startsWith(dir + path.sep) && abs !== dir) return null
  return abs
}

export function backupDayKey(at = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}`
}

export function backupStamp(at = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${backupDayKey(at)}-${p(at.getHours())}${p(at.getMinutes())}`
}

export function backupForDay(
  rows: BackupFileMeta[],
  day = backupDayKey(),
): BackupFileMeta | null {
  const prefix = `wallapop_crm-${day}-`
  return rows.find((row) => row.file.startsWith(prefix)) ?? null
}

export async function ensureBackupDir(): Promise<string> {
  const dir = backupDir()
  await mkdir(dir, { recursive: true })
  return dir
}

async function metaFor(dir: string, file: string): Promise<BackupFileMeta | null> {
  if (!isSafeBackupName(file)) return null
  const info = await stat(path.join(dir, file))
  if (!info.isFile()) return null
  return { file, size: info.size, mtime: info.mtime.toISOString() }
}

export async function listBackupFiles(): Promise<BackupFileMeta[]> {
  const dir = await ensureBackupDir()
  const names = await readdir(dir)
  const rows: BackupFileMeta[] = []
  for (const name of names) {
    const row = await metaFor(dir, name)
    if (row) rows.push(row)
  }
  rows.sort((a, b) => (a.mtime < b.mtime ? 1 : -1))
  return rows
}

export async function rotateBackupFiles(keep = BACKUP_KEEP): Promise<void> {
  const rows = await listBackupFiles()
  for (const row of rows.slice(keep)) {
    const abs = resolveBackupPath(row.file)
    if (abs) await unlink(abs)
  }
}

export function latestBackup(rows: BackupFileMeta[]): BackupFileMeta | null {
  return rows[0] ?? null
}
