"use client"

import { useEffect, useState } from "react"
import { LoaderCircleIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { isApiConfigured } from "@/lib/api/config"
import type { ApiAutopostStatus } from "@/lib/api/types"
import {
  getDefaultAccountAutopost,
  getWallapopAccountStatus,
  startAutopost,
  stopAutopost,
  updateAutopostInterval,
  wallapopAccountErrorMessage,
  type WallapopConnectionStatus,
} from "@/lib/api/wallapop-account"
import {
  formatAutopostCountdown,
  formatListingPostedAt,
} from "@/lib/inventory/format"
import {
  AUTOPOST_INTERVAL_UNITS,
  autopostIntervalPatchSchema,
  msToAutopostIntervalInput,
  type AutopostIntervalUnit,
} from "@/lib/validations/account"

const UNIT_LABEL: Record<AutopostIntervalUnit, string> = {
  seconds: "Segundos",
  minutes: "Minutos",
  hours: "Horas",
  days: "Días",
}

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

function useAutopostNextTickLabel(
  nextTickAt: string | null | undefined,
  enabled: boolean,
): string | null {
  const [label, setLabel] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) {
      setLabel(null)
      return
    }

    function refresh() {
      if (!nextTickAt) {
        setLabel("Comprobando la cola…")
        return
      }
      const remainingMs = new Date(nextTickAt).getTime() - Date.now()
      setLabel(formatAutopostCountdown(remainingMs))
    }

    refresh()
    const timer = window.setInterval(refresh, 1000)
    return () => window.clearInterval(timer)
  }, [enabled, nextTickAt])

  return label
}

export function AutopostIntervalForm() {
  const apiReady = isApiConfigured()
  const [value, setValue] = useState("15")
  const [unit, setUnit] = useState<AutopostIntervalUnit>("minutes")
  const [autopost, setAutopost] = useState<ApiAutopostStatus | null>(null)
  const [sessionStatus, setSessionStatus] =
    useState<WallapopConnectionStatus>("DISCONNECTED")
  const [loading, setLoading] = useState(apiReady)
  const [saving, setSaving] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [startConfirmOpen, setStartConfirmOpen] = useState(false)

  useEffect(() => {
    if (!apiReady) return

    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const [next, session] = await Promise.all([
          getDefaultAccountAutopost(),
          getWallapopAccountStatus().catch(() => null),
        ])
        if (cancelled) return
        const parsed = msToAutopostIntervalInput(
          next.autopost.effectiveIntervalMs,
        )
        setValue(String(parsed.value))
        setUnit(parsed.unit)
        setAutopost(next.autopost)
        if (session) setSessionStatus(session.status)
        setError(null)
      } catch (err) {
        if (!cancelled) setError(wallapopAccountErrorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [apiReady])

  const running = autopost?.enabled === true
  const nextTickLabel = useAutopostNextTickLabel(
    autopost?.nextTickAt,
    running,
  )

  useEffect(() => {
    if (!apiReady || !running) return

    let cancelled = false
    const timer = window.setInterval(() => {
      void getDefaultAccountAutopost()
        .then((next) => {
          if (!cancelled) setAutopost(next.autopost)
        })
        .catch(() => {})
    }, 15000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [apiReady, running])

  useEffect(() => {
    if (!saved) return
    const timer = window.setTimeout(() => setSaved(false), 2500)
    return () => window.clearTimeout(timer)
  }, [saved])

  async function onSave(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSaved(false)

    const parsedValue = Number(value)
    const parsed = autopostIntervalPatchSchema.safeParse({
      value: parsedValue,
      unit,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Revisa el intervalo.")
      return
    }

    setSaving(true)
    try {
      const next = await updateAutopostInterval(parsed.data)
      const shown = msToAutopostIntervalInput(
        next.autopost.effectiveIntervalMs,
      )
      setValue(String(shown.value))
      setUnit(shown.unit)
      setAutopost(next.autopost)
      setSaved(true)
    } catch (err) {
      setError(wallapopAccountErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function onStart() {
    setStartConfirmOpen(false)
    setError(null)
    setToggling(true)
    try {
      const next = await startAutopost()
      setAutopost(next.autopost)
    } catch (err) {
      setError(wallapopAccountErrorMessage(err))
    } finally {
      setToggling(false)
    }
  }

  async function onStop() {
    setError(null)
    setToggling(true)
    try {
      const next = await stopAutopost()
      setAutopost(next.autopost)
    } catch (err) {
      setError(wallapopAccountErrorMessage(err))
    } finally {
      setToggling(false)
    }
  }

  const busy = loading || saving || toggling
  const sessionActive = sessionStatus === "ACTIVE"
  const lastLabel = autopost?.lastPublication
    ? `${autopost.lastPublication.title} · ${formatListingPostedAt(autopost.lastPublication.at) ?? ""}`
    : "Aún no hay publicaciones"

  return (
    <div className="mx-auto w-full max-w-md border-t border-border pt-8">
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

      {autopost?.recentSkips && autopost.recentSkips.length > 0 ? (
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
      ) : null}

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
            onClick={() => void onStop()}
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
            onClick={() => setStartConfirmOpen(true)}
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

      <form onSubmit={onSave} className="flex flex-col gap-4">
        <div className="grid grid-cols-[1fr_8.5rem] gap-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="autopost-interval-value">Cantidad</Label>
            <Input
              id="autopost-interval-value"
              name="value"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              className="h-12 text-base md:h-10 md:text-sm"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={!apiReady || busy}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="autopost-interval-unit">Unidad</Label>
            <select
              id="autopost-interval-unit"
              name="unit"
              className="h-12 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:h-10 md:text-sm"
              value={unit}
              onChange={(event) =>
                setUnit(event.target.value as AutopostIntervalUnit)
              }
              disabled={!apiReady || busy}
            >
              {AUTOPOST_INTERVAL_UNITS.map((item) => (
                <option key={item} value={item}>
                  {UNIT_LABEL[item]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <Button
          type="submit"
          variant="outline"
          className="h-12 w-full"
          disabled={!apiReady || busy}
          aria-busy={saving || undefined}
        >
          {saving ? <LoaderCircleIcon className="animate-spin" /> : null}
          {saving ? "Guardando…" : "Guardar intervalo"}
        </Button>
      </form>

      <Dialog open={startConfirmOpen} onOpenChange={setStartConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Iniciar el autopost?</DialogTitle>
            <DialogDescription>
              Solo se publicarán anuncios en «Listo para publicar» de esta
              cuenta de Wallapop. No hay supervisión de qué hay o no hay ya en
              el marketplace. Si un artículo ya está en Wallapop pero el CRM no
              lo sabe, se puede duplicar.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full sm:w-auto"
              onClick={() => setStartConfirmOpen(false)}
            >
              Volver
            </Button>
            <Button
              type="button"
              className="h-11 w-full sm:w-auto"
              disabled={toggling}
              onClick={() => void onStart()}
            >
              {toggling ? <LoaderCircleIcon className="animate-spin" /> : null}
              Iniciar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
