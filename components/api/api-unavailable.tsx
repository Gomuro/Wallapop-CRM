"use client"

import { Button } from "@/components/ui/button"
import type { ApiUnavailableReason } from "@/lib/api/availability"

type Props = {
  reason: ApiUnavailableReason
  className?: string
}

const COPY: Record<
  ApiUnavailableReason,
  { title: string; body: string; hint?: string }
> = {
  config: {
    title: "API no configurada",
    body:
      "La aplicación no tiene la dirección del servidor. El administrador debe definir NEXT_PUBLIC_API_PROXY + API_UPSTREAM (Vercel) o NEXT_PUBLIC_API_URL y arrancar Express en el VPS.",
    hint: "En local: .env en la raíz → NEXT_PUBLIC_API_URL=http://localhost:4000 y npm run server:dev",
  },
  unreachable: {
    title: "Servidor no disponible",
    body:
      "No se ha podido contactar con la API. Comprueba que el servidor esté en marcha en el VPS, la red y CORS_ORIGIN para este sitio.",
    hint: "Prueba a actualizar la página en un minuto.",
  },
}

export function ApiUnavailable({ reason, className }: Props) {
  const copy = COPY[reason]

  return (
    <div
      className={
        className ??
        "flex min-h-[50dvh] flex-col items-center justify-center gap-4 px-6 py-12 text-center"
      }
    >
      <div className="max-w-md space-y-2">
        <h1 className="text-lg font-semibold tracking-tight">{copy.title}</h1>
        <p className="text-sm text-muted-foreground">{copy.body}</p>
        {copy.hint ? (
          <p className="text-xs text-muted-foreground/80">{copy.hint}</p>
        ) : null}
      </div>
      <Button
        type="button"
        variant="outline"
        className="h-11"
        onClick={() => window.location.reload()}
      >
        Actualizar página
      </Button>
    </div>
  )
}
