"use client"

import { useEffect, useState, useSyncExternalStore } from "react"

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
  autopostIntervalPatchSchema,
  msToAutopostIntervalInput,
  type AutopostIntervalUnit,
} from "@/lib/validations/account"

let nowMs = 0
let nowTimer: ReturnType<typeof setInterval> | number | undefined
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

export type AutopostSetters = {
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

export async function saveAutopostInterval(ctx: {
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

export async function startAutopostRun(setters: AutopostSetters) {
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

export async function stopAutopostRun(setters: AutopostSetters) {
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

export type AutopostIntervalValues = {
  apiReady: boolean
  value: string
  unit: AutopostIntervalUnit
  autopost: ApiAutopostStatus | null
  running: boolean
  nextTickLabel: string | null
  sessionActive: boolean
  lastLabel: string
}

export type AutopostIntervalBusy = {
  loading: boolean
  saving: boolean
  toggling: boolean
  error: string | null
  saved: boolean
  startConfirmOpen: boolean
  busy: boolean
}

export type AutopostIntervalControls = {
  setters: AutopostSetters
  setValue: (value: string) => void
  setUnit: (unit: AutopostIntervalUnit) => void
}

export type AutopostIntervalState = AutopostIntervalValues &
  AutopostIntervalBusy &
  AutopostIntervalControls

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
