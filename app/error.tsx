"use client"

import Link from "next/link"
import { useEffect } from "react"

import { Button } from "@/components/ui/button"
import { actionFailureMessage } from "@/lib/api/action-error"
import { typeScreen } from "@/lib/ui/type"

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  const detail = actionFailureMessage(error)
  const raw = error.message || ""
  const isProtocolError = /unexpected response was received from the server/i.test(
    raw,
  )

  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <h1 className={typeScreen}>No se ha podido mostrar esta pantalla</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        El almacén responde. Ha fallado la interfaz, no el servidor. Prueba de
        nuevo o vuelve al catálogo.
      </p>
      <p className="max-w-md text-sm text-destructive" role="alert">
        {isProtocolError ? detail : raw || detail}
      </p>
      {error.digest ? (
        <p className="font-mono text-[11px] text-muted-foreground/80">
          Digest: {error.digest}
        </p>
      ) : null}
      <Button type="button" className="h-11" onClick={() => reset()}>
        Volver a intentar
      </Button>
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
