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
