import Link from "next/link"
import { ChevronLeftIcon } from "lucide-react"

import { createProductAction } from "@/app/actions/products"
import { ProductForm } from "@/components/product-form/product-form"
import { Button } from "@/components/ui/button"

export default function NewProductPage() {
  return (
    <>
      <header className="sticky top-0 z-30 flex items-center gap-1 border-b bg-background px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <Button
          variant="ghost"
          size="icon"
          nativeButton={false}
          render={<Link href="/" />}
          aria-label="Back to catalog"
        >
          <ChevronLeftIcon />
        </Button>
        <h1 className="text-base font-semibold">New item</h1>
      </header>
      <ProductForm action={createProductAction} submitLabel="Create item" />
    </>
  )
}
