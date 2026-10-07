import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { nanoid } from "nanoid"
import sharp from "sharp"

import {
  isAllowedImageType,
  MAX_IMAGE_BYTES,
  shouldWriteUploadToDisk,
  UPLOAD_DIR,
  UPLOAD_PUBLIC_PATH,
  type AllowedImageType,
} from "./config"

const FORMAT_BY_TYPE: Record<AllowedImageType, "jpeg" | "png" | "webp"> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
}

const MIME_BY_FORMAT = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const

const EXT_BY_FORMAT = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
} as const

const FS_UNAVAILABLE = new Set(["ENOENT", "EROFS", "EACCES", "EPERM"])

function isFsUnavailable(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return false
  return FS_UNAVAILABLE.has(String(error.code))
}

export type SavedStrippedImage = {
  url: string
  storageKey: string
}

export function encodeStrippedPipeline(
  buffer: Buffer,
  target: "jpeg" | "png" | "webp",
) {
  let pipeline = sharp(buffer, { failOn: "error" }).rotate()
  if (target === "jpeg") {
    pipeline = pipeline.jpeg({ quality: 85, mozjpeg: true })
  } else if (target === "png") {
    pipeline = pipeline.png({ compressionLevel: 9 })
  } else {
    pipeline = pipeline.webp({ quality: 85 })
  }
  return pipeline
}

export function dataUrlStrippedImage(
  mime: string,
  bytes: Buffer,
  storageKey: string,
): SavedStrippedImage {
  return {
    storageKey,
    url: `data:${mime};base64,${bytes.toString("base64")}`,
  }
}

export async function persistStrippedBytes(
  bytes: Buffer,
  mime: string,
  storageKey: string,
): Promise<SavedStrippedImage> {
  if (!shouldWriteUploadToDisk()) {
    return dataUrlStrippedImage(mime, bytes, storageKey)
  }
  try {
    await mkdir(UPLOAD_DIR, { recursive: true })
    await writeFile(path.join(UPLOAD_DIR, storageKey), bytes)
  } catch (error) {
    if (isFsUnavailable(error)) {
      return dataUrlStrippedImage(mime, bytes, storageKey)
    }
    throw error
  }
  return {
    storageKey,
    url: `${UPLOAD_PUBLIC_PATH}/${storageKey}`,
  }
}

export async function saveStrippedImageBuffer(
  buffer: Buffer,
  declaredType: string,
): Promise<SavedStrippedImage> {
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error("La imagen debe pesar 10MB o menos.")
  }
  if (!isAllowedImageType(declaredType)) {
    throw new Error("Usa JPEG, PNG o WebP.")
  }
  const metadata = await sharp(buffer, { failOn: "error" }).metadata()
  const target = FORMAT_BY_TYPE[declaredType]
  if (metadata.format !== target) {
    throw new Error("El tipo de archivo no coincide con el contenido.")
  }
  const bytes = await encodeStrippedPipeline(buffer, target).toBuffer()
  return persistStrippedBytes(
    bytes,
    MIME_BY_FORMAT[target],
    `${nanoid(16)}.${EXT_BY_FORMAT[target]}`,
  )
}
