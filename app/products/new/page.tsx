import Link from "next/link"
import { ChevronLeftIcon } from "lucide-react"

import { createProductAction } from "@/app/actions/products"
import { ApiUnavailable } from "@/components/api/api-unavailable"
import { ProductForm } from "@/components/product-form/product-form"
import { Button } from "@/components/ui/button"
import { apiUnavailableReason } from "@/lib/api/availability"
import { isApiConfigured } from "@/lib/api/config"
import { listCategoryRoots } from "@/lib/inventory/store"
import type { ApiCategory } from "@/lib/api/types"
import { typeScreen } from "@/lib/ui/type"

export default async function NewProductPage() {
  if (!isApiConfigured()) {
    return <ApiUnavailable reason="config" />
  }

  let roots: ApiCategory[]
  try {
    roots = await listCategoryRoots()
  } catch (error) {
    const reason = apiUnavailableReason(error) ?? "unreachable"
    return <ApiUnavailable reason={reason} />
  }
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
        initialRoots={roots}
        action={createProductAction}
        submitLabel="Publicar"
      />
    </>
  )
}
