import multer from "multer"

import { MAX_IMAGE_BYTES } from "../../../lib/uploads/config"

const storage = multer.memoryStorage()

const upload = multer({
  storage,
  limits: { fileSize: MAX_IMAGE_BYTES },
})

export const uploadProductImages = upload.array("files", 10)
export const uploadReplaceImage = upload.single("file")
