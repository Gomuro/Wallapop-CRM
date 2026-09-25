import { unlink } from "node:fs/promises"
import path from "node:path"

import { UPLOAD_DIR } from "./config"

export async function deleteLocalImage(storageKey: string) {
  try {
    await unlink(path.join(UPLOAD_DIR, storageKey))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== "ENOENT") throw error
  }
}
