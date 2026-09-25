"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback } from "react"
import { ChevronLeftIcon } from "lucide-react"

import { ProductForm } from "@/components/product-form/product-form"
import { OfflineBanner } from "@/components/offline/offline-banner"
import { Button } from "@/components/ui/button"
import type { ProductActionState } from "@/app/actions/products"
import type { ApiCategory } from "@/lib/api/types"
import { OfflineSkuError, upsertOfflineProduct } from "@/lib/offline/cache"
import { useOfflineCategories } from "@/lib/offline/use-offline-cache"
import { typeScreen } from "@/lib/ui/type"
import type { ProductCondition, ProductStatus } from "@/lib/validations"
import { productCreateSchema } from "@/lib/validations/product"

function payloadFromForm(formData: FormData) {
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
    images: [] as string[],
    status: String(formData.get("status") || "ACTIVE") as ProductStatus,
  }
}

function fieldErrorsFromZod(error: {
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

export function OfflineNewProduct({
  initialCategories,
}: {
  initialCategories?: ApiCategory[]
}) {
  const router = useRouter()
  const cachedCategories = useOfflineCategories()
  const categories =
    initialCategories && initialCategories.length > 0
      ? initialCategories
      : cachedCategories

  const action = useCallback(
    async (
      _prev: ProductActionState,
      formData: FormData,
    ): Promise<ProductActionState> => {
      const parsed = productCreateSchema.safeParse(payloadFromForm(formData))
      if (!parsed.success) {
        return {
          error: "Revisa los campos marcados.",
          fieldErrors: fieldErrorsFromZod(parsed.error),
        }
      }

      try {
        const product = upsertOfflineProduct(
          {
            sku: parsed.data.sku,
            title: parsed.data.title,
            description: parsed.data.description,
            price: parsed.data.price,
            categoryId: parsed.data.categoryId,
            condition: parsed.data.condition,
            weight: parsed.data.weight,
            status: parsed.data.status,
          },
          categories,
        )
        router.push(`/products/${product.id}`)
        return {}
      } catch (error) {
        if (error instanceof OfflineSkuError) {
          return {
            error: error.message,
            fieldErrors: { sku: error.message },
          }
        }
        return { error: "No se pudo guardar el producto. Inténtalo de nuevo." }
      }
    },
    [categories, router],
  )

  return (
    <>
      <OfflineBanner />
      <header className="sticky top-0 z-30 flex items-center gap-1 border-b bg-background px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:top-14 md:px-8">
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          nativeButton={false}
          render={<Link href="/" />}
          aria-label="Volver al catálogo"
        >
          <ChevronLeftIcon />
        </Button>
        <h1 className={typeScreen}>Subir producto</h1>
      </header>
      <ProductForm
        categories={categories}
        action={action}
        submitLabel="Publicar"
      />
    </>
  )
}
