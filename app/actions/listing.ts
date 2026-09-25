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

  return {
    externalUrl: externalUrlRaw === "" ? null : externalUrlRaw,
    ...(statusRaw ? { status: statusRaw } : {}),
  }
}

export async function updateProductListingAction(
  productId: string,
  _prev: ListingActionState,
  formData: FormData,
): Promise<ListingActionState> {
  const parsed = productListingApiPutBodySchema.safeParse(formToListingBody(formData))
  if (!parsed.success) {
    return {
      error: "Check the highlighted fields.",
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
    return { error: "Could not save Wallapop listing. Try again." }
  }
}
