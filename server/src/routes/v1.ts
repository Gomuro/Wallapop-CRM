import { Router } from "express"

import { requireAuth } from "../middleware/require-auth"
import { uploadReplaceImage } from "../middleware/upload"
import { login, logout, me } from "./auth"
import {
  createBackupNow,
  downloadBackup,
  listBackups,
} from "./backups"
import { catalog } from "./catalog"
import { putOpsUpload } from "./ops-uploads"

export const v1 = Router()

v1.post("/auth/login", login)
v1.use(requireAuth)
v1.post("/auth/logout", logout)
v1.get("/auth/me", me)
v1.get("/backups", listBackups)
v1.post("/backups", createBackupNow)
v1.get("/backups/:file", downloadBackup)
v1.put("/ops/uploads/:storageKey", uploadReplaceImage, putOpsUpload)
v1.use(catalog)
