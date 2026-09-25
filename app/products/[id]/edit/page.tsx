import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronLeftIcon } from "lucide-react"

import { updateProductAction } from "@/app/actions/products"
import { ApiUnavailable } from "@/components/api/api-unavailable"
import { ListingFields } from "@/components/product-form/listing-fields"
import { ProductForm } from "@/components/product-form/product-form"
import { Button } from "@/components/ui/button"
import { CategoryCacheHydrator } from "@/components/offline/category-cache-hydrator"
import { OfflineEditProduct } from "@/components/offline/offline-edit-product"
import { apiUnavailableReason, isTransportFailure } from "@/lib/api/availability"
import { isApiConfigured } from "@/lib/api/config"
import { getProduct, listCategoriesFlat } from "@/lib/inventory/store"
import { typeScreen } from "@/lib/ui/type"

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (!isApiConfigured()) {
    return <ApiUnavailable reason="config" />
  }

  const { id } = await params
  if (id.startsWith("offline_")) {
    return <OfflineEditProduct id={id} />
  }

  let product: Awaited<ReturnType<typeof getProduct>>
  let categories: Awaited<ReturnType<typeof listCategoriesFlat>>
  try {
    ;[product, categories] = await Promise.all([
      getProduct(id),
      listCategoriesFlat(),
    ])
  } catch (error) {
    if (isTransportFailure(error)) {
      return <OfflineEditProduct id={id} />
    }
    const reason = apiUnavailableReason(error) ?? "unreachable"
    return <ApiUnavailable reason={reason} />
  }
  if (!product) notFound()

  const action = updateProductAction.bind(null, product.id)

  return (
    <>
      <CategoryCacheHydrator categories={categories} />
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
      <div className="flex flex-col gap-4">
        <ProductForm
          key={product.id}
          categories={categories}
          product={product}
          action={action}
          submitLabel="Guardar"
        />
        <div className="px-4 pb-8 md:px-8 lg:mx-auto lg:max-w-xl lg:px-0">
          <ListingFields productId={product.id} listing={product.listing} />
        </div>
      </div>
    </>
  )
}
