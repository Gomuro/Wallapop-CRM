"use server"

import { revalidatePath } from "next/cache"

import {
  apiDeleteProductImage,
  apiReorderProductImages,
  apiUploadProductImages,
} from "@/lib/api/images"
import { ApiError } from "@/lib/api/errors"
import { resolveMediaUrl } from "@/lib/api/config"
import { PRODUCT_IMAGE_MAX } from "@/lib/validations/product"

export type UploadImagesResult = {
  urls: string[]
  imageIds?: string[]
  error?: string
}

function filesFromFormData(formData: FormData) {
  return formData
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0)
}

export async function uploadProductImages(
  formData: FormData,
  productId?: string,
): Promise<UploadImagesResult> {
  const files = filesFromFormData(formData)

  if (files.length === 0) {
    return { urls: [], error: "No hay imágenes seleccionadas." }
  }
  if (files.length > PRODUCT_IMAGE_MAX) {
    return { urls: [], error: `Máximo ${PRODUCT_IMAGE_MAX} fotos.` }
  }

  if (!productId) {
    return {
      urls: [],
      error: "Guarda el producto primero y después añade fotos.",
    }
  }

  try {
    const payload = new FormData()
    files.forEach((file) => payload.append("files", file))
    const product = await apiUploadProductImages(productId, payload)
    revalidatePath(`/products/${productId}`)
    revalidatePath(`/products/${productId}/edit`)
    revalidatePath("/")
    const sorted = product.images
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
    return {
      urls: sorted.map((image) => resolveMediaUrl(image.url)),
      imageIds: sorted.map((image) => image.id),
    }
  } catch (error) {
    const message =
      error instanceof ApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : "No se pudo guardar la imagen."
    return { urls: [], error: message }
  }
}

export async function reorderProductImagesAction(
  productId: string,
  ids: string[],
): Promise<{ error?: string }> {
  try {
    await apiReorderProductImages(productId, ids)
    revalidatePath(`/products/${productId}`)
    revalidatePath(`/products/${productId}/edit`)
    revalidatePath("/")
    return {}
  } catch (error) {
    return {
      error:
        error instanceof ApiError
          ? error.message
          : "No se pudieron reordenar las fotos.",
    }
  }
}

export async function deleteProductImageAction(
  productId: string,
  imageId: string,
): Promise<{ error?: string }> {
  try {
    await apiDeleteProductImage(productId, imageId)
    revalidatePath(`/products/${productId}`)
    revalidatePath(`/products/${productId}/edit`)
    revalidatePath("/")
    return {}
  } catch (error) {
    return {
      error:
        error instanceof ApiError ? error.message : "No se pudo eliminar la foto.",
    }
  }
}
