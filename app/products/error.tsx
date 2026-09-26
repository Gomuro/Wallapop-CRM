"use client"

import { ProductLoadError } from "@/components/catalog/product-load-error"
import { Button } from "@/components/ui/button"

export default function ProductsError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-3">
      <ProductLoadError
        title="No se ha podido mostrar esta pantalla"
        body="El almacén responde. Ha fallado la interfaz, no el servidor."
      />
      <Button type="button" className="h-11" onClick={() => reset()}>
        Volver a intentar
      </Button>
    </div>
  )
}
