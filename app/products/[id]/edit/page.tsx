import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronLeftIcon } from "lucide-react"

import { updateProductAction } from "@/app/actions/products"
import { ProductForm } from "@/components/product-form/product-form"
import { Button } from "@/components/ui/button"
import { getProduct } from "@/lib/inventory/store"
import { typeScreen } from "@/lib/ui/type"

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const product = await getProduct(id)
  if (!product) notFound()

  const action = updateProductAction.bind(null, product.id)

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center gap-1 border-b bg-background px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <Button
          variant="ghost"
          size="icon"
          nativeButton={false}
          render={<Link href={`/products/${product.id}`} />}
          aria-label="Back to item"
        >
          <ChevronLeftIcon />
        </Button>
        <h1 className={typeScreen}>Edit item</h1>
      </header>
      <ProductForm
        product={product}
        action={action}
        submitLabel="Save changes"
      />
    </>
  )
}
