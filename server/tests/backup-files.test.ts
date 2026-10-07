import { mkdir, writeFile } from "node:fs/promises"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  backupForDay,
  backupStamp,
  isSafeBackupName,
  listBackupFiles,
  rotateBackupFiles,
} from "../src/lib/backup-files"

const prevDir = process.env.BACKUP_DIR

afterEach(() => {
  if (prevDir === undefined) delete process.env.BACKUP_DIR
  else process.env.BACKUP_DIR = prevDir
})

describe("backup file names", () => {
  it("accepts stamped pgdump names only", () => {
    expect(isSafeBackupName("wallapop_crm-20261007-1801.pgdump")).toBe(true)
    expect(isSafeBackupName("../secret.pgdump")).toBe(false)
    expect(isSafeBackupName("wallapop_crm-20261007-1801.sql")).toBe(false)
  })

  it("formats a local stamp", () => {
    expect(backupStamp(new Date(2026, 9, 7, 18, 1))).toBe("20261007-1801")
  })

  it("reuses the dump already taken that calendar day", () => {
    const today = backupForDay(
      [
        {
          file: "wallapop_crm-20261007-0315.pgdump",
          size: 10,
          mtime: "2026-10-07T01:15:00.000Z",
        },
      ],
      "20261007",
    )
    expect(today?.file).toBe("wallapop_crm-20261007-0315.pgdump")
    expect(
      backupForDay(
        [
          {
            file: "wallapop_crm-20261006-0315.pgdump",
            size: 10,
            mtime: "2026-10-06T01:15:00.000Z",
          },
        ],
        "20261007",
      ),
    ).toBeNull()
  })
})

describe("backup rotation", () => {
  it("keeps the newest seven files", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "crm-bak-"))
    process.env.BACKUP_DIR = dir
    await mkdir(dir, { recursive: true })
    for (let i = 0; i < 9; i++) {
      const name = `wallapop_crm-2026100${i}-1200.pgdump`
      await writeFile(path.join(dir, name), String(i))
    }
    await rotateBackupFiles(7)
    const left = await listBackupFiles()
    expect(left).toHaveLength(7)
  })
})
