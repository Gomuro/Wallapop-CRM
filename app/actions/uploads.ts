"use server"

import { PRODUCT_IMAGE_MAX } from "@/lib/validations/product"
import { saveStrippedImage } from "@/lib/uploads/save-image"

export type UploadImagesResult = {
  urls: string[]
  error?: string
}

export async function uploadProductImages(
  formData: FormData,
): Promise<UploadImagesResult> {
  const files = formData
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0)

  if (files.length === 0) {
    return { urls: [], error: "No images selected." }
  }
  if (files.length > PRODUCT_IMAGE_MAX) {
    return { urls: [], error: `Maximum ${PRODUCT_IMAGE_MAX} photos.` }
  }

  try {
    const urls: string[] = []
    for (const file of files) {
      urls.push(await saveStrippedImage(file))
    }
    return { urls }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not save image."
    return { urls: [], error: message }
  }
}
