"use client"

import { useEffect, useState } from "react"

import { ApiError } from "@/lib/api/errors"
import { fetchQueueNewProducts, setQueueNewProducts } from "@/lib/api/queue-new-products"
import { cn } from "@/lib/utils"

export function QueueNewProductsSwitch() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchQueueNewProducts()
      .then((next) => {
        if (!cancelled) setEnabled(next)
      })
      .catch(() => {
        if (!cancelled) setError("No se ha podido cargar el ajuste.")
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function toggle() {
    if (enabled === null || pending) return
    setPending(true)
    setError(null)
    try {
      setEnabled(await setQueueNewProducts(!enabled))
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "No se ha podido guardar.",
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border px-3 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">Cola al crear</p>
        <p className="text-xs text-muted-foreground">
          Un producto nuevo entra en la cola de todas las cuentas.
        </p>
        {error ? (
          <p className="mt-1 text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled === true}
        aria-label="Poner en cola en todas las cuentas al crear un producto"
        disabled={enabled === null || pending}
        onClick={() => void toggle()}
        className={cn(
          "relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50",
          enabled ? "bg-primary" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "absolute top-1 size-6 rounded-full bg-background shadow-sm transition-[left]",
            enabled ? "left-7" : "left-1",
          )}
        />
      </button>
    </div>
  )
}
