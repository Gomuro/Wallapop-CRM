"use client"

import { LoaderCircleIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { ApiAutopostStatus } from "@/lib/api/types"
import {
  msToAutopostIntervalInput,
  type AutopostIntervalUnit,
} from "@/lib/validations/account"

import {
  stopAutopostRun,
  type AutopostIntervalState,
} from "./autopost-interval-state"

const UNIT_SHORT: Record<AutopostIntervalUnit, string> = {
  seconds: "s",
  minutes: "min",
  hours: "h",
  days: "d",
}

function formatIntervalHint(autopost: ApiAutopostStatus): string {
  const { value, unit } = msToAutopostIntervalInput(
    autopost.effectiveIntervalMs,
  )
  const jitterPct = Math.round(autopost.jitterFraction * 100)
  return `Entre publicaciones: ~${value} ${UNIT_SHORT[unit]} (varía un ±${jitterPct} %)`
}

export function AutopostRecentSkips({
  autopost,
}: {
  autopost: ApiAutopostStatus | null
}) {
  if (!autopost?.recentSkips || autopost.recentSkips.length === 0) return null
  return (
    <div className="mb-4 rounded-lg border border-border px-3 py-2">
      <p className="text-sm font-medium">Omitidos (envío)</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Sin peso: no se publican y la cola sigue con el siguiente.
      </p>
      <ul className="mt-2 space-y-1.5">
        {autopost.recentSkips.slice(0, 8).map((skip) => (
          <li key={`${skip.productId}-${skip.at}`} className="text-sm">
            <span className="font-medium">{skip.title}</span>
            {skip.sku ? (
              <span className="text-muted-foreground"> · {skip.sku}</span>
            ) : null}
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {skip.message}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function AutopostStatusCard({ state }: { state: AutopostIntervalState }) {
  const {
    apiReady,
    autopost,
    running,
    nextTickLabel,
    lastLabel,
    error,
    saved,
    toggling,
    sessionActive,
    setters,
  } = state

  return (
    <>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Autopost Wallapop
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Publica solo anuncios aún no subidos en esta cuenta de Wallapop
            (listos para publicar). No sincroniza ventas ni estados del
            marketplace.
          </p>
        </div>
      </div>

      {autopost ? (
        <div className="mb-4 flex flex-wrap gap-2">
          <Badge variant={running ? "default" : "outline"}>
            Autopost: {running ? "en marcha" : "parado"}
          </Badge>
          <Badge variant={autopost.livePublish ? "default" : "secondary"}>
            Publicación: {autopost.livePublish ? "en vivo" : "simulación"}
          </Badge>
        </div>
      ) : null}

      {autopost ? (
        <p className="mb-2 text-sm text-muted-foreground">
          {formatIntervalHint(autopost)}
        </p>
      ) : null}

      <p className="mb-4 text-sm text-muted-foreground">
        Última publicación: {lastLabel}
      </p>

      {running && nextTickLabel ? (
        <p
          className="mb-4 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm tabular-nums"
          aria-live="polite"
        >
          <span className="text-muted-foreground">
            Próxima comprobación de la cola:{" "}
          </span>
          <span className="font-medium text-foreground">{nextTickLabel}</span>
        </p>
      ) : null}

      <AutopostRecentSkips autopost={autopost} />

      {error ? (
        <p
          className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {saved ? (
        <p
          className="mb-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
          aria-live="polite"
        >
          Guardado
        </p>
      ) : null}

      <div className="mb-6">
        {running ? (
          <Button
            type="button"
            variant="destructive"
            className="h-12 w-full"
            disabled={!apiReady || toggling}
            onClick={() => void stopAutopostRun(setters)}
            aria-busy={toggling || undefined}
          >
            {toggling ? <LoaderCircleIcon className="animate-spin" /> : null}
            {toggling ? "Deteniendo…" : "Detener autopost"}
          </Button>
        ) : (
          <Button
            type="button"
            className="h-12 w-full"
            disabled={!apiReady || toggling || !sessionActive}
            onClick={() => setters.setStartConfirmOpen(true)}
          >
            Iniciar autopost
          </Button>
        )}
        {!sessionActive ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Conecta la cuenta de Wallapop para poder iniciar.
          </p>
        ) : null}
      </div>
    </>
  )
}
