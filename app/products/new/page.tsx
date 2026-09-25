import Link from "next/link"
import { ChevronLeftIcon } from "lucide-react"

import { createProductAction } from "@/app/actions/products"
import { ProductForm } from "@/components/product-form/product-form"
import { Button } from "@/components/ui/button"
import { listCategoriesFlat } from "@/lib/inventory/store"
import { typeScreen } from "@/lib/ui/type"

export default async function NewProductPage() {
  const categories = await listCategoriesFlat()
  return (
    <>
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
        action={createProductAction}
        submitLabel="Publicar"
      />
    </>
  )
}
