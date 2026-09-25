import "server-only"

import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { nanoid } from "nanoid"
import sharp from "sharp"

import {
  isAllowedImageType,
  MAX_IMAGE_BYTES,
  shouldWriteUploadToDisk,
  UPLOAD_PUBLIC_PATH,
  type AllowedImageType,
} from "@/lib/uploads/config"

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

function toDataUri(bytes: Buffer, mime: string) {
  return `data:${mime};base64,${bytes.toString("base64")}`
}

function isFsUnavailable(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return false
  return FS_UNAVAILABLE.has(String(error.code))
}

export async function saveStrippedImage(file: File): Promise<string> {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("Image must be 10MB or smaller.")
  }

  const declaredType = file.type
  if (!isAllowedImageType(declaredType)) {
    throw new Error("Use JPEG, PNG, or WebP.")
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const metadata = await sharp(buffer, { failOn: "error" }).metadata()
  const detected = metadata.format
  const target = FORMAT_BY_TYPE[declaredType]

  if (detected !== target) {
    throw new Error("File type does not match contents.")
  }

  // rotate() applies EXIF orientation; omitting withMetadata() strips EXIF/GPS.
  let pipeline = sharp(buffer, { failOn: "error" }).rotate()
  if (target === "jpeg") {
    pipeline = pipeline.jpeg({ quality: 85, mozjpeg: true })
  } else if (target === "png") {
    pipeline = pipeline.png({ compressionLevel: 9 })
  } else {
    pipeline = pipeline.webp({ quality: 85 })
  }

  const bytes = await pipeline.toBuffer()
  const mime = MIME_BY_FORMAT[target]

  if (!shouldWriteUploadToDisk()) {
    return toDataUri(bytes, mime)
  }

  const filename = `${nanoid(16)}.${EXT_BY_FORMAT[target]}`
  try {
    await mkdir(path.join(process.cwd(), "public", "uploads"), { recursive: true })
    await writeFile(
      path.join(process.cwd(), "public", "uploads", filename),
      bytes,
    )
  } catch (error) {
    if (isFsUnavailable(error)) {
      return toDataUri(bytes, mime)
    }
    throw error
  }

  return `${UPLOAD_PUBLIC_PATH}/${filename}`
}

export function isLocalUploadUrl(url: string) {
  return url.startsWith(`${UPLOAD_PUBLIC_PATH}/`)
}
