"use server"

import { revalidatePath } from "next/cache"
import { isRedirectError } from "next/dist/client/components/redirect-error"
import { redirect } from "next/navigation"

import { apiUploadProductImages } from "@/lib/api/images"
import { ApiError, apiErrorToFieldErrors } from "@/lib/api/errors"
import {
  createProduct,
  deleteProduct,
  getProduct,
  markProductSold,
  updateProduct,
} from "@/lib/inventory/store"
import {
  productCreateSchema,
  productUpdateSchema,
} from "@/lib/validations/product"
import type { ProductCondition, ProductStatus } from "@/lib/validations"

export type ProductActionState = {
  error?: string
  fieldErrors?: Record<string, string>
}

function revalidateProductViews(id?: string) {
  revalidatePath("/")
  revalidatePath("/products")
  if (id) {
    revalidatePath(`/products/${id}`)
    revalidatePath(`/products/${id}/edit`)
  }
}

function filesFromFormData(formData: FormData) {
  return formData
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0)
}

function formToPayload(formData: FormData) {
  const weightRaw = String(formData.get("weight") ?? "").trim()
  const priceRaw = String(formData.get("price") ?? "").trim()
  const conditionRaw = String(formData.get("condition") ?? "GOOD").trim()

  return {
    sku: String(formData.get("sku") ?? ""),
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
    price: priceRaw === "" ? Number.NaN : Number(priceRaw),
    categoryId: String(formData.get("categoryId") ?? ""),
    condition: conditionRaw as ProductCondition,
    weight: weightRaw === "" ? null : Number(weightRaw),
    images: [],
    status: String(formData.get("status") || "ACTIVE") as ProductStatus,
  }
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

function transportOrUnknownError(error: unknown): ProductActionState {
  if (error instanceof ApiError) {
    const fieldErrors = apiErrorToFieldErrors(error)
    const skuTaken =
      fieldErrors.sku ?? (error.status === 409 ? "Ese SKU ya existe." : undefined)
    return {
      error: skuTaken ?? error.message,
      fieldErrors: skuTaken ? { sku: skuTaken, ...fieldErrors } : fieldErrors,
    }
  }
  return { error: "No se pudo guardar el producto. Inténtalo de nuevo." }
}

async function uploadFilesAfterCreate(productId: string, formData: FormData) {
  const files = filesFromFormData(formData)
  if (files.length === 0) return
  const payload = new FormData()
  files.forEach((file) => payload.append("files", file))
  await apiUploadProductImages(productId, payload)
}

export async function createProductAction(
  _prev: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const parsed = productCreateSchema.safeParse(formToPayload(formData))
  if (!parsed.success) {
    return {
      error: "Revisa los campos marcados.",
      fieldErrors: firstFieldError(parsed.error),
    }
  }

  let product: Awaited<ReturnType<typeof createProduct>>
  try {
    product = await createProduct(parsed.data)
  } catch (error) {
    if (isRedirectError(error)) throw error
    return transportOrUnknownError(error)
  }

  try {
    await uploadFilesAfterCreate(product.id, formData)
  } catch (error) {
    if (isRedirectError(error)) throw error
    revalidateProductViews(product.id)
    return {
      error:
        "El producto se creó, pero no se pudieron subir las fotos. Ábrelo y súbelas de nuevo.",
    }
  }

  revalidateProductViews(product.id)
  redirect(`/products/${product.id}`)
}

export async function updateProductAction(
  id: string,
  _prev: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const parsed = productUpdateSchema.safeParse(formToPayload(formData))
  if (!parsed.success) {
    return {
      error: "Revisa los campos marcados.",
      fieldErrors: firstFieldError(parsed.error),
    }
  }

  let existing: Awaited<ReturnType<typeof getProduct>>
  try {
    existing = await getProduct(id)
  } catch (error) {
    if (isRedirectError(error)) throw error
    return transportOrUnknownError(error)
  }
  if (!existing) {
    return { error: "Producto no encontrado." }
  }

  try {
    const product = await updateProduct(id, parsed.data, {
      status: parsed.data.status,
      previousStatus: existing.status,
    })
    if (!product) {
      return { error: "Producto no encontrado." }
    }

    revalidateProductViews(id)
    redirect(`/products/${id}`)
  } catch (error) {
    if (isRedirectError(error)) throw error
    return transportOrUnknownError(error)
  }
}

const SOLD_ERRORS = {
  "not-found": "Producto no encontrado.",
  "already-sold": "Este producto ya está vendido.",
} as const

export async function markProductSoldAction(
  id: string,
): Promise<{ error?: string }> {
  try {
    const result = await markProductSold(id)
    if (!result.ok) return { error: SOLD_ERRORS[result.reason] }
    revalidateProductViews(id)
    return {}
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message }
    return { error: "No se pudo marcar como vendido." }
  }
}

export async function deleteProductAction(
  id: string,
): Promise<{ error?: string }> {
  try {
    const removed = await deleteProduct(id)
    if (!removed) return { error: "Producto no encontrado." }
    revalidateProductViews(id)
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message }
    return { error: "No se pudo eliminar el producto." }
  }
  redirect("/")
}
