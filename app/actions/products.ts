"use server"

import { revalidatePath } from "next/cache"
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
    externalLinks: [] as string[],
  }
}

function firstFieldError(error: { issues: readonly { path: PropertyKey[]; message: string }[] }) {
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
      error: "Check the highlighted fields.",
      fieldErrors: firstFieldError(parsed.error),
    }
  }

  const product = createProduct(parsed.data)
  revalidateProductViews(product.id)
  redirect(`/products/${product.id}`)
}

export async function updateProductAction(
  id: string,
  _prev: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const existing = getProduct(id)
  if (!existing) {
    return { error: "Product not found." }
  }

  const parsed = productUpdateSchema.safeParse(formToPayload(formData))
  if (!parsed.success) {
    return {
      error: "Check the highlighted fields.",
      fieldErrors: firstFieldError(parsed.error),
    }
  }

  const product = updateProduct(id, parsed.data)
  if (!product) {
    return { error: "Product not found." }
  }

  revalidateProductViews(id)
  redirect(`/products/${id}`)
}

export async function markProductSoldAction(id: string): Promise<void> {
  const product = markProductSold(id)
  if (!product) {
    throw new Error("Product not found.")
  }
  revalidateProductViews(id)
}

export async function deleteProductAction(id: string): Promise<void> {
  const removed = deleteProduct(id)
  if (!removed) {
    throw new Error("Product not found.")
  }
  revalidateProductViews(id)
  redirect("/")
}
