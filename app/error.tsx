"use client"

import Link from "next/link"
import { useEffect } from "react"

import { ApiUnavailable } from "@/components/api/api-unavailable"
import { OfflineBanner } from "@/components/offline/offline-banner"
import { Button } from "@/components/ui/button"
import { isApiConfigured } from "@/lib/api/config"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  if (!isApiConfigured()) {
    return <ApiUnavailable reason="config" className="min-h-dvh" />
  }

  return (
    <div className="flex flex-col">
      <OfflineBanner />
      <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <p className="max-w-md text-sm text-muted-foreground">
          Puedes seguir usando el catálogo guardado en este dispositivo.
        </p>
        <Button type="button" className="h-11" onClick={() => reset()}>
          Volver a intentar
        </Button>
        <Button
          variant="outline"
          className="h-11"
          nativeButton={false}
          render={<Link href="/" />}
        >
          Ir al catálogo
        </Button>
      </div>
    </div>
  )
}
