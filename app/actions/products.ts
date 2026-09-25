"use server"

import { revalidatePath } from "next/cache"
import { isRedirectError } from "next/dist/client/components/redirect-error"
import { redirect } from "next/navigation"

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

function parseImages(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== "string" || raw.trim() === "") return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === "string")
  } catch {
    return []
  }
}

function formToPayload(formData: FormData) {
  const weightRaw = String(formData.get("weight") ?? "").trim()
  const priceRaw = String(formData.get("price") ?? "").trim()

  return {
    sku: String(formData.get("sku") ?? ""),
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
    price: priceRaw === "" ? Number.NaN : Number(priceRaw),
    category: String(formData.get("category") ?? ""),
    condition: String(formData.get("condition") ?? ""),
    weight: weightRaw === "" ? null : Number(weightRaw),
    images: parseImages(formData.get("images")),
    status: String(formData.get("status") || "ACTIVE"),
  }
}

function isUniqueSkuError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  )
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

  try {
    const product = await createProduct(parsed.data)
    revalidateProductViews(product.id)
    redirect(`/products/${product.id}`)
  } catch (error) {
    if (isRedirectError(error)) throw error
    if (isUniqueSkuError(error)) {
      return {
        error: "Ese SKU ya existe.",
        fieldErrors: { sku: "Ese SKU ya existe." },
      }
    }
    return { error: "No se pudo guardar el producto. Inténtalo de nuevo." }
  }
}

export async function updateProductAction(
  id: string,
  _prev: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const existing = await getProduct(id)
  if (!existing) {
    return { error: "Producto no encontrado." }
  }

  const parsed = productUpdateSchema.safeParse(formToPayload(formData))
  if (!parsed.success) {
    return {
      error: "Revisa los campos marcados.",
      fieldErrors: firstFieldError(parsed.error),
    }
  }

  try {
    const product = await updateProduct(id, parsed.data)
    if (!product) {
      return { error: "Producto no encontrado." }
    }

    revalidateProductViews(id)
    redirect(`/products/${id}`)
  } catch (error) {
    if (isRedirectError(error)) throw error
    if (isUniqueSkuError(error)) {
      return {
        error: "Ese SKU ya existe.",
        fieldErrors: { sku: "Ese SKU ya existe." },
      }
    }
    return { error: "No se pudo guardar el producto. Inténtalo de nuevo." }
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
  } catch {
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
  } catch {
    return { error: "No se pudo eliminar el producto." }
  }
  redirect("/")
}
