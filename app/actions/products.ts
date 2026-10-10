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
  listProductPage,
  markProductSold,
  updateProduct,
} from "@/lib/inventory/store"
import {
  CATALOG_PAGE_SIZE,
  type InventoryProduct,
} from "@/lib/inventory/types"
import { apiGetCategory } from "@/lib/api/categories"
import {
  brandFromTypeAttributes,
  typeAttributesFromFormData,
  validateExtraUploadFields,
} from "@/lib/inventory/category-upload-fields"
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

function generateFallbackSku(): string {
  return `WP-${Date.now().toString().slice(-6)}`
}

function optionalFormNumber(formData: FormData, name: string) {
  const raw = String(formData.get(name) ?? "").trim()
  return raw === "" ? null : Number(raw)
}

function formToPayload(formData: FormData, fallbackSku?: string) {
  const conditionRaw = String(formData.get("condition") ?? "GOOD").trim()
  const rawSku = String(formData.get("sku") ?? "").trim()
  const packageRaw = String(formData.get("shippingPackageSize") ?? "").trim()
  const typeAttributes = typeAttributesFromFormData(formData)

  return {
    sku: rawSku || fallbackSku || generateFallbackSku(),
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
    price: optionalFormNumber(formData, "price") ?? Number.NaN,
    categoryId: String(formData.get("categoryId") ?? ""),
    condition: conditionRaw as ProductCondition,
    brand: brandFromTypeAttributes(typeAttributes),
    weight: optionalFormNumber(formData, "weight"),
    shippingPackageSize:
      packageRaw === "STANDARD" || packageRaw === "BULKY" ? packageRaw : null,
    widthCm: optionalFormNumber(formData, "widthCm"),
    lengthCm: optionalFormNumber(formData, "lengthCm"),
    heightCm: optionalFormNumber(formData, "heightCm"),
    images: [],
    status: String(formData.get("status") || "ACTIVE") as ProductStatus,
    typeAttributes,
  }
}

async function extraFieldErrors(
  categoryId: string,
  typeAttributes: unknown,
): Promise<Record<string, string>> {
  if (!categoryId) return {}
  try {
    const category = await apiGetCategory(categoryId)
    return validateExtraUploadFields(category.fields ?? [], typeAttributes)
  } catch {
    return {}
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

function markedFieldsState(
  fieldErrors: Record<string, string>,
): ProductActionState {
  return { error: "Revisa los campos marcados.", fieldErrors }
}

async function validateCreatePayload(formData: FormData) {
  const parsed = productCreateSchema.safeParse(formToPayload(formData))
  if (!parsed.success) {
    return { ok: false as const, state: markedFieldsState(firstFieldError(parsed.error)) }
  }
  const extraErrors = await extraFieldErrors(
    parsed.data.categoryId,
    parsed.data.typeAttributes,
  )
  if (Object.keys(extraErrors).length > 0) {
    return { ok: false as const, state: markedFieldsState(extraErrors) }
  }
  return { ok: true as const, data: parsed.data }
}

async function validateUpdatePayload(
  formData: FormData,
  existing: NonNullable<Awaited<ReturnType<typeof getProduct>>>,
) {
  const parsed = productUpdateSchema.safeParse(
    formToPayload(formData, existing.sku),
  )
  if (!parsed.success) {
    return { ok: false as const, state: markedFieldsState(firstFieldError(parsed.error)) }
  }
  const extraErrors = await extraFieldErrors(
    parsed.data.categoryId ?? existing.categoryId,
    parsed.data.typeAttributes,
  )
  if (Object.keys(extraErrors).length > 0) {
    return { ok: false as const, state: markedFieldsState(extraErrors) }
  }
  return { ok: true as const, data: parsed.data }
}

export async function createProductAction(
  _prev: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const checked = await validateCreatePayload(formData)
  if (!checked.ok) return checked.state

  let product: Awaited<ReturnType<typeof createProduct>>
  try {
    product = await createProduct(checked.data)
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

  const checked = await validateUpdatePayload(formData, existing)
  if (!checked.ok) return checked.state

  try {
    const product = await updateProduct(id, checked.data, {
      status: checked.data.status,
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

const CATALOG_STATUS = new Set(["ALL", "ACTIVE", "SOLD", "INACTIVE"])

export async function loadCatalogPage(input: {
  page: number
  q?: string
  status?: "ALL" | ProductStatus
}): Promise<
  | { ok: true; products: InventoryProduct[]; total: number; page: number }
  | { ok: false; error: string }
> {
  const page = Number(input.page)
  if (!Number.isInteger(page) || page < 2) {
    return { ok: false, error: "Página no válida." }
  }
  const status = CATALOG_STATUS.has(input.status ?? "ALL")
    ? (input.status ?? "ALL")
    : "ALL"
  try {
    const result = await listProductPage({
      page,
      pageSize: CATALOG_PAGE_SIZE,
      q: input.q?.trim() || undefined,
      status,
    })
    return {
      ok: true,
      products: result.products,
      total: result.total,
      page: result.page,
    }
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, error: error.message }
    return { ok: false, error: "No se han podido cargar más productos." }
  }
}
