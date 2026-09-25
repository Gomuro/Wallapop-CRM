import path from "node:path"

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const

export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number]

export const UPLOAD_DIR =
  process.env.UPLOAD_DIR?.trim() ||
  path.join(process.cwd(), "public", "uploads")

export const UPLOAD_PUBLIC_PATH = "/uploads"

export function isAllowedImageType(value: string): value is AllowedImageType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(value)
}

export function isServerlessRuntime() {
  return Boolean(
    process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.LAMBDA_TASK_ROOT,
  )
}

export function isPublicDir(dir: string) {
  const publicRoot = path.resolve(process.cwd(), "public")
  const resolved = path.resolve(dir)
  return resolved === publicRoot || resolved.startsWith(publicRoot + path.sep)
}

/** Serverless/read-only hosts cannot mkdir or write under /public. */
export function shouldWriteUploadToDisk() {
  if (isServerlessRuntime()) return false
  if (process.env.NODE_ENV === "production" && isPublicDir(UPLOAD_DIR)) {
    return false
  }
  return true
}
