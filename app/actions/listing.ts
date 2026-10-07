"use server"

import { revalidatePath } from "next/cache"

import { ApiError } from "@/lib/api/errors"
import { apiErrorMessage } from "@/lib/inventory/format"
import { updateProductListing } from "@/lib/inventory/store"
import { productListingApiPutBodySchema } from "@/lib/validations/listing"

export type ListingActionState = {
  error?: string
  fieldErrors?: Record<string, string>
  success?: boolean
}

function revalidateProductViews(productId: string) {
  revalidatePath("/")
  revalidatePath("/products")
  revalidatePath(`/products/${productId}`)
  revalidatePath(`/products/${productId}/edit`)
}

function firstFieldError(error: {
  issues: readonly { path: PropertyKey[]; message: string }[]
}) {
  const fieldErrors: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path[0]
    if (typeof key === "string" && !fieldErrors[key]) {
      fieldErrors[key] = issue.message
    }
  }
  return fieldErrors
}

function formToListingBody(formData: FormData) {
  const externalUrlRaw = String(formData.get("externalUrl") ?? "").trim()
  const statusRaw = String(formData.get("listingStatus") ?? "").trim()
  const keepUrlIfEmpty = String(formData.get("keepUrlIfEmpty") ?? "") === "1"
  const clearListingUrl = String(formData.get("clearListingUrl") ?? "") === "1"

  const shippingRaw = String(formData.get("shippingEnabled") ?? "").trim()
  const body: {
    externalUrl?: string | null
    status?: string
    shippingEnabled?: boolean
  } = {}

  if (clearListingUrl) {
    body.externalUrl = null
  } else if (externalUrlRaw !== "") {
    body.externalUrl = externalUrlRaw
  } else if (!keepUrlIfEmpty) {
    body.externalUrl = null
  }

  if (statusRaw) body.status = statusRaw
  if (shippingRaw === "true") body.shippingEnabled = true
  if (shippingRaw === "false") body.shippingEnabled = false
  return body
}

export async function updateProductListingAction(
  productId: string,
  _prev: ListingActionState,
  formData: FormData,
): Promise<ListingActionState> {
  const body = formToListingBody(formData)
  if (Object.keys(body).length === 0) {
    return { success: true }
  }
  const parsed = productListingApiPutBodySchema.safeParse(body)
  if (!parsed.success) {
    return {
      error: "Revisa los campos marcados.",
      fieldErrors: firstFieldError(parsed.error),
    }
  }

  try {
    await updateProductListing(productId, parsed.data)
    revalidateProductViews(productId)
    return { success: true }
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        error: apiErrorMessage(error.code, error.message),
        fieldErrors:
          error.code === "VALIDATION_ERROR"
            ? { externalUrl: error.message }
            : undefined,
      }
    }
    return { error: "No se pudo guardar el anuncio de Wallapop. Inténtalo de nuevo." }
  }
}
