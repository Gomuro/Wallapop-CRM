"use client"

import { LoaderCircleIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { ApiAutopostStatus, ApiWorkerJob } from "@/lib/api/types"
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

function formatCadence(autopost: ApiAutopostStatus): string {
  const { value, unit } = msToAutopostIntervalInput(
    autopost.effectiveIntervalMs,
  )
  return `cada ~${value} ${UNIT_SHORT[unit]}`
}

const WORKER_MARK: Record<ApiWorkerJob["state"], string> = {
  queued: "En cola",
  running: "Ahora",
  done: "Hecho",
  failed: "Error",
}

export function AutopostRecentSkips({
  autopost,
}: {
  autopost: ApiAutopostStatus | null
}) {
  if (!autopost?.recentSkips || autopost.recentSkips.length === 0) return null
  return (
    <div>
      <p className="text-sm font-medium">Omitidos</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Sin peso: la cola sigue con el siguiente.
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

function workerCopy(job: ApiWorkerJob): { label: string; detail: string } {
  if (job.kind === "publish") {
    return { label: "Publicación", detail: "Publicando un anuncio…" }
  }
  if (job.kind === "devolucion") {
    if (job.state === "queued") {
      return {
        label: "Devolución",
        detail: "En cola. Se eliminará el anuncio y el producto volverá a la cola.",
      }
    }
    if (job.state === "running") {
      return {
        label: "Devolución",
        detail: "Eliminando el anuncio en Wallapop. El producto vuelve a la cola.",
      }
    }
    if (job.state === "done") {
      return {
        label: "Devolución",
        detail: "Anuncio eliminado. El producto está otra vez en la cola.",
      }
    }
    return { label: "Devolución", detail: job.message ?? "No se pudo eliminar el anuncio." }
  }
  if (job.kind === "eliminar") {
    if (job.state === "queued") {
      return {
        label: "Eliminar",
        detail: "En cola. Se borrará el anuncio. El producto se queda desactivado.",
      }
    }
    if (job.state === "running") {
      return {
        label: "Eliminar",
        detail: "Eliminando el anuncio en Wallapop. El producto se queda en el CRM.",
      }
    }
    if (job.state === "done") {
      return {
        label: "Eliminar",
        detail: "Anuncio eliminado. El producto está desactivado.",
      }
    }
    return { label: "Eliminar", detail: job.message ?? "No se pudo eliminar el anuncio." }
  }
  if (job.state === "queued") {
    return { label: "Venta", detail: "En cola para marcar como vendido." }
  }
  if (job.state === "running") {
    return { label: "Venta", detail: "Marcando como vendido en Wallapop." }
  }
  if (job.state === "done") {
    return { label: "Venta", detail: "Marcado como vendido." }
  }
  return { label: "Venta", detail: job.message ?? "No se pudo marcar como vendido." }
}

function AccountWorkers({ workers }: { workers: ApiWorkerJob[] }) {
  if (workers.length === 0) return null
  return (
    <ul className="flex flex-col gap-2" aria-live="polite">
      {workers.map((job) => {
        const copy = workerCopy(job)
        return (
          <li
            key={`${job.kind}-${job.productId}-${job.state}`}
            className="rounded-lg bg-muted/40 px-3 py-2.5"
          >
            <span className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{copy.label}</span>
              <span
                className={
                  job.state === "failed"
                    ? "shrink-0 text-xs font-medium text-destructive"
                    : "shrink-0 text-xs font-medium text-muted-foreground"
                }
              >
                {WORKER_MARK[job.state]}
              </span>
            </span>
            {job.kind === "publish" ? null : (
              <span className="mt-0.5 block truncate">{job.title}</span>
            )}
            <span
              className={
                job.state === "failed"
                  ? "mt-1 block text-destructive"
                  : "mt-1 block text-muted-foreground"
              }
            >
              {copy.detail}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function autopostSummary(
  autopost: ApiAutopostStatus | null,
  running: boolean,
): string {
  if (!autopost) return running ? "En marcha" : "Parado"
  const mode = autopost.livePublish ? "en vivo" : "simulación"
  return `${running ? "En marcha" : "Parado"} · ${mode} · ${formatCadence(autopost)}`
}

function AutopostNotices({ error, saved }: { error: string | null; saved: boolean }) {
  return (
    <>
      {error ? (
        <p
          className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Intervalo guardado
        </p>
      ) : null}
    </>
  )
}

function AutopostToggle({
  accountId,
  running,
  apiReady,
  toggling,
  sessionActive,
  setters,
}: Pick<
  AutopostIntervalState,
  "accountId" | "running" | "apiReady" | "toggling" | "sessionActive" | "setters"
>) {
  return (
    <>
      {running ? (
        <Button
          type="button"
          variant="destructive"
          className="h-12 w-full"
          disabled={!apiReady || toggling}
          onClick={() => void stopAutopostRun(setters, accountId)}
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
      {sessionActive ? null : (
        <p className="mt-2 text-xs text-muted-foreground">
          Conecta la cuenta de Wallapop para poder iniciar.
        </p>
      )}
    </>
  )
}

export function AutopostStatusCard({ state }: { state: AutopostIntervalState }) {
  const {
    accountId,
    apiReady,
    autopost,
    workers,
    running,
    nextTickLabel,
    lastLabel,
    error,
    saved,
    toggling,
    sessionActive,
    setters,
  } = state

  const publishing =
    running && autopost?.publishing && !workers.some((job) => job.kind === "publish")
  const waitingEmpty =
    running && !autopost?.publishing && autopost?.readyToPostCount === 0
  const nextCheck =
    running &&
    !autopost?.publishing &&
    autopost?.readyToPostCount !== 0 &&
    autopost?.nextTickAt &&
    nextTickLabel

  return (
    <>
      <CardHeader className="border-b">
        <CardTitle>Autopost</CardTitle>
        <CardDescription>
          {autopostSummary(autopost, running)}. Solo anuncios listos para
          publicar.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <AccountWorkers workers={workers} />
        <dl className="grid grid-cols-[5.5rem_1fr] gap-y-1 text-sm">
          <dt className="text-muted-foreground">Última</dt>
          <dd className="min-w-0 truncate">{lastLabel}</dd>
          {publishing ? (
            <>
              <dt className="text-muted-foreground">Ahora</dt>
              <dd>Publicando un anuncio…</dd>
            </>
          ) : null}
          {waitingEmpty ? (
            <>
              <dt className="text-muted-foreground">Cola</dt>
              <dd>Nada listo para publicar</dd>
            </>
          ) : null}
          {nextCheck ? (
            <>
              <dt className="text-muted-foreground">Siguiente</dt>
              <dd className="tabular-nums">{nextTickLabel}</dd>
            </>
          ) : null}
        </dl>
        <AutopostRecentSkips autopost={autopost} />
        <AutopostNotices error={error} saved={saved} />
        <AutopostToggle
          accountId={accountId}
          running={running}
          apiReady={apiReady}
          toggling={toggling}
          sessionActive={sessionActive}
          setters={setters}
        />
      </CardContent>
    </>
  )
}
