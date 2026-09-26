import Link from "next/link"

import { Button } from "@/components/ui/button"
import { typeScreen } from "@/lib/ui/type"

export function ProductLoadError({
  title = "No se ha podido cargar este producto",
  body = "El almacén responde. Ha fallado la interfaz, no el servidor.",
}: {
  title?: string
  body?: string
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <h1 className={typeScreen}>{title}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{body}</p>
      <Button
        variant="outline"
        className="h-11"
        nativeButton={false}
        render={<Link href="/" />}
      >
        Volver al catálogo
      </Button>
    </div>
  )
}
