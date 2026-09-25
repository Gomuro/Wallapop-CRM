import "server-only"

import {
  MAX_IMAGE_BYTES,
  UPLOAD_PUBLIC_PATH,
} from "@/lib/uploads/config"
import { saveStrippedImageBuffer } from "@/lib/uploads/save-stripped-buffer"

export async function saveStrippedImage(file: File): Promise<string> {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("La imagen debe pesar 10MB o menos.")
  }
  const buffer = Buffer.from(await file.arrayBuffer())
  const { url } = await saveStrippedImageBuffer(buffer, file.type)
  return url
}

export function isLocalUploadUrl(url: string) {
  return url.startsWith(`${UPLOAD_PUBLIC_PATH}/`)
}
