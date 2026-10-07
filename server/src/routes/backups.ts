import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"

import type { Request, Response } from "express"

import { createBackup } from "../lib/backup-dump"
import {
  listBackupFiles,
  resolveBackupPath,
} from "../lib/backup-files"
import { sendError } from "../lib/http-error"
import { log, serializeError } from "../lib/log"

export async function listBackups(_req: Request, res: Response) {
  try {
    const files = await listBackupFiles()
    res.json({ files })
  } catch (err) {
    log("error", "backup_list_failed", { err: serializeError(err) })
    sendError(res, 500, "BACKUP_FAILED", "No se pudo listar las copias.")
  }
}

export async function createBackupNow(_req: Request, res: Response) {
  try {
    const result = await createBackup()
    res.status(result.reused ? 200 : 201).json(result)
  } catch (err) {
    log("error", "backup_create_failed", { err: serializeError(err) })
    sendError(
      res,
      500,
      "BACKUP_FAILED",
      "No se pudo crear la copia (¿pg_dump instalado?).",
    )
  }
}

export async function downloadBackup(req: Request, res: Response) {
  const name = String(req.params.file ?? "")
  const abs = resolveBackupPath(name)
  if (!abs) {
    sendError(res, 400, "VALIDATION_ERROR", "Nombre de copia no válido.")
    return
  }
  try {
    const info = await stat(abs)
    if (!info.isFile()) {
      sendError(res, 404, "NOT_FOUND", "No existe esa copia.")
      return
    }
    res.setHeader("Content-Type", "application/octet-stream")
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`)
    res.setHeader("Content-Length", String(info.size))
    createReadStream(abs).pipe(res)
  } catch {
    sendError(res, 404, "NOT_FOUND", "No existe esa copia.")
  }
}
