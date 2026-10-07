import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import type { Request, Response } from "express"

import {
  isSafeStorageKey,
  UPLOAD_DIR,
} from "../../../lib/uploads/config"
import { sendError } from "../lib/http-error"

function uploadFile(req: Request): Express.Multer.File | undefined {
  const file = req.file
  return file && Buffer.isBuffer(file.buffer) ? file : undefined
}

export async function putOpsUpload(req: Request, res: Response) {
  const key = String(req.params.storageKey ?? "")
  if (!isSafeStorageKey(key)) {
    sendError(res, 400, "VALIDATION_ERROR", "Invalid storage key.")
    return
  }
  const file = uploadFile(req)
  if (!file) {
    sendError(res, 400, "VALIDATION_ERROR", "Missing file.")
    return
  }
  const dir = path.resolve(process.cwd(), UPLOAD_DIR)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, key), file.buffer)
  res.json({ ok: true, storageKey: key })
}
