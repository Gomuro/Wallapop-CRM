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
import { OfflineSkuError, getOfflineProduct, upsertOfflineProduct } from "@/lib/offline/cache"
import { useOfflineCategories, useOfflineProduct } from "@/lib/offline/use-offline-cache"
import { typeScreen } from "@/lib/ui/type"
import type { ProductCondition, ProductStatus } from "@/lib/validations"
import { productUpdateSchema } from "@/lib/validations/product"

function generateFallbackSku(): string {
  return `WP-${Date.now().toString().slice(-6)}`
}

function payloadFromForm(formData: FormData, fallbackSku?: string) {
  const weightRaw = String(formData.get("weight") ?? "").trim()
  const priceRaw = String(formData.get("price") ?? "").trim()
  const conditionRaw = String(formData.get("condition") ?? "GOOD").trim()
  const rawSku = String(formData.get("sku") ?? "").trim()

  return {
    sku: rawSku || fallbackSku || generateFallbackSku(),
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

export function OfflineEditProduct({
  id,
  initialCategories,
}: {
  id: string
  initialCategories?: ApiCategory[]
}) {
  const router = useRouter()
  const product = useOfflineProduct(id)
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
      const current = getOfflineProduct(id)
      if (!current) return { error: "Producto no encontrado." }

      const parsed = productUpdateSchema.safeParse(
        payloadFromForm(formData, current.sku),
      )
      if (!parsed.success) {
        return {
          error: "Revisa los campos marcados.",
          fieldErrors: fieldErrorsFromZod(parsed.error),
        }
      }

      try {
        upsertOfflineProduct(
          {
            id,
            sku: parsed.data.sku ?? current.sku,
            title: parsed.data.title ?? current.title,
            description: parsed.data.description ?? current.description,
            price: parsed.data.price ?? current.price,
            categoryId: parsed.data.categoryId ?? current.categoryId,
            condition: parsed.data.condition ?? current.conditionCode,
            weight:
              parsed.data.weight === undefined ? current.weight : parsed.data.weight,
            status: parsed.data.status ?? current.status,
            images: current.images,
          },
          categories,
        )
        router.push(`/products/${id}`)
        router.refresh()
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
    [categories, id, router],
  )

  if (product === undefined) {
    return (
      <>
        <OfflineBanner />
        <p className="px-4 py-8 text-sm text-muted-foreground">Cargando producto…</p>
      </>
    )
  }

  if (!product) {
    return (
      <>
        <OfflineBanner />
        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <p className="text-sm text-muted-foreground">
            Este producto no está en la caché de este dispositivo.
          </p>
          <Button className="h-11" nativeButton={false} render={<Link href="/" />}>
            Volver al catálogo
          </Button>
        </div>
      </>
    )
  }

  return (
    <>
      <OfflineBanner />
      <header className="sticky top-0 z-30 flex items-center gap-1 border-b bg-background px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:top-14 md:px-8">
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          nativeButton={false}
          render={<Link href={`/products/${product.id}`} />}
          aria-label="Volver al producto"
        >
          <ChevronLeftIcon />
        </Button>
        <h1 className={typeScreen}>Editar producto</h1>
      </header>
      <ProductForm
        key={product.id}
        categories={categories}
        product={product}
        action={action}
        submitLabel="Guardar"
      />
    </>
  )
}
