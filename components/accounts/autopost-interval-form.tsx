"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
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

let nowMs = 0
let nowTimer: ReturnType<typeof window.setInterval> | undefined
const nowListeners = new Set<() => void>()

function emitNow() {
  nowMs = Date.now()
  nowListeners.forEach((listener) => listener())
}

function subscribeNow(onStoreChange: () => void) {
  nowListeners.add(onStoreChange)
  if (nowTimer === undefined) {
    emitNow()
    nowTimer = window.setInterval(emitNow, 1000)
  }
  return () => {
    nowListeners.delete(onStoreChange)
    if (nowListeners.size === 0 && nowTimer !== undefined) {
      window.clearInterval(nowTimer)
      nowTimer = undefined
    }
  }
}

function useAutopostNextTickLabel(
  nextTickAt: string | null | undefined,
  enabled: boolean,
): string | null {
  const now = useSyncExternalStore(
    enabled ? subscribeNow : () => () => {},
    () => nowMs,
    () => 0,
  )
  if (!enabled) return null
  if (!nextTickAt) return "Comprobando la cola…"
  return formatAutopostCountdown(new Date(nextTickAt).getTime() - now)
}

type AutopostSetters = {
  setValue: (value: string) => void
  setUnit: (unit: AutopostIntervalUnit) => void
  setAutopost: (autopost: ApiAutopostStatus | null) => void
  setSessionStatus: (status: WallapopConnectionStatus) => void
  setLoading: (loading: boolean) => void
  setSaving: (saving: boolean) => void
  setToggling: (toggling: boolean) => void
  setError: (error: string | null) => void
  setSaved: (saved: boolean) => void
  setStartConfirmOpen: (open: boolean) => void
}

function subscribeAutopostLoad(setters: AutopostSetters) {
  let cancelled = false

  async function load() {
    setters.setLoading(true)
    try {
      const [next, session] = await Promise.all([
        getDefaultAccountAutopost(),
        getWallapopAccountStatus().catch(() => null),
      ])
      if (cancelled) return
      const parsed = msToAutopostIntervalInput(next.autopost.effectiveIntervalMs)
      setters.setValue(String(parsed.value))
      setters.setUnit(parsed.unit)
      setters.setAutopost(next.autopost)
      if (session) setters.setSessionStatus(session.status)
      setters.setError(null)
    } catch (err) {
      if (!cancelled) setters.setError(wallapopAccountErrorMessage(err))
    } finally {
      if (!cancelled) setters.setLoading(false)
    }
  }

  void load()
  return () => {
    cancelled = true
  }
}

async function saveAutopostInterval(ctx: {
  event: React.FormEvent
  value: string
  unit: AutopostIntervalUnit
  setters: AutopostSetters
}) {
  ctx.event.preventDefault()
  ctx.setters.setError(null)
  ctx.setters.setSaved(false)

  const parsedValue = Number(ctx.value)
  const parsed = autopostIntervalPatchSchema.safeParse({
    value: parsedValue,
    unit: ctx.unit,
  })
  if (!parsed.success) {
    ctx.setters.setError(parsed.error.issues[0]?.message ?? "Revisa el intervalo.")
    return
  }

  ctx.setters.setSaving(true)
  try {
    const next = await updateAutopostInterval(parsed.data)
    const shown = msToAutopostIntervalInput(next.autopost.effectiveIntervalMs)
    ctx.setters.setValue(String(shown.value))
    ctx.setters.setUnit(shown.unit)
    ctx.setters.setAutopost(next.autopost)
    ctx.setters.setSaved(true)
  } catch (err) {
    ctx.setters.setError(wallapopAccountErrorMessage(err))
  } finally {
    ctx.setters.setSaving(false)
  }
}

async function startAutopostRun(setters: AutopostSetters) {
  setters.setStartConfirmOpen(false)
  setters.setError(null)
  setters.setToggling(true)
  try {
    const next = await startAutopost()
    setters.setAutopost(next.autopost)
  } catch (err) {
    setters.setError(wallapopAccountErrorMessage(err))
  } finally {
    setters.setToggling(false)
  }
}

async function stopAutopostRun(setters: AutopostSetters) {
  setters.setError(null)
  setters.setToggling(true)
  try {
    const next = await stopAutopost()
    setters.setAutopost(next.autopost)
  } catch (err) {
    setters.setError(wallapopAccountErrorMessage(err))
  } finally {
    setters.setToggling(false)
  }
}

export type AutopostIntervalState = {
  apiReady: boolean
  value: string
  unit: AutopostIntervalUnit
  autopost: ApiAutopostStatus | null
  loading: boolean
  saving: boolean
  toggling: boolean
  error: string | null
  saved: boolean
  startConfirmOpen: boolean
  running: boolean
  nextTickLabel: string | null
  busy: boolean
  sessionActive: boolean
  lastLabel: string
  setters: AutopostSetters
  setValue: (value: string) => void
  setUnit: (unit: AutopostIntervalUnit) => void
}

export function useAutopostIntervalState(): AutopostIntervalState {
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

  const setters: AutopostSetters = {
    setValue,
    setUnit,
    setAutopost,
    setSessionStatus,
    setLoading,
    setSaving,
    setToggling,
    setError,
    setSaved,
    setStartConfirmOpen,
  }

  useEffect(() => {
    if (!apiReady) return
    return subscribeAutopostLoad(setters)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setState fns are stable
  }, [apiReady])

  const running = autopost?.enabled === true
  const nextTickLabel = useAutopostNextTickLabel(autopost?.nextTickAt, running)

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

  const busy = loading || saving || toggling
  const sessionActive = sessionStatus === "ACTIVE"
  const lastLabel = autopost?.lastPublication
    ? `${autopost.lastPublication.title} · ${formatListingPostedAt(autopost.lastPublication.at) ?? ""}`
    : "Aún no hay publicaciones"

  return {
    apiReady,
    value,
    unit,
    autopost,
    loading,
    saving,
    toggling,
    error,
    saved,
    startConfirmOpen,
    running,
    nextTickLabel,
    busy,
    sessionActive,
    lastLabel,
    setters,
    setValue,
    setUnit,
  }
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

export function AutopostIntervalFields({
  state,
}: {
  state: AutopostIntervalState
}) {
  const { apiReady, value, unit, busy, saving, setters, setValue, setUnit } =
    state

  return (
    <form
      onSubmit={(event) => void saveAutopostInterval({ event, value, unit, setters })}
      className="flex flex-col gap-4"
    >
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
  )
}

export function AutopostStartConfirmDialog({
  state,
}: {
  state: AutopostIntervalState
}) {
  const { startConfirmOpen, toggling, setters } = state
  return (
    <Dialog open={startConfirmOpen} onOpenChange={setters.setStartConfirmOpen}>
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
            onClick={() => setters.setStartConfirmOpen(false)}
          >
            Volver
          </Button>
          <Button
            type="button"
            className="h-11 w-full sm:w-auto"
            disabled={toggling}
            onClick={() => void startAutopostRun(setters)}
          >
            {toggling ? <LoaderCircleIcon className="animate-spin" /> : null}
            Iniciar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AutopostIntervalForm() {
  const state = useAutopostIntervalState()
  return (
    <div className="mx-auto w-full max-w-md border-t border-border pt-8">
      <AutopostStatusCard state={state} />
      <AutopostIntervalFields state={state} />
      <AutopostStartConfirmDialog state={state} />
    </div>
  )
}
