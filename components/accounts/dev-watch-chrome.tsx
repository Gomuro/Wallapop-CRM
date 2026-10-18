"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { openDevAccountWatch } from "@/lib/api/dev-monitor"
import { ApiError } from "@/lib/api/errors"

export function DevWatchChrome({ accountId }: { accountId: string }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function open() {
    setPending(true)
    setError(null)
    try {
      await openDevAccountWatch(accountId)
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "No se pudo abrir Chrome.",
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-1 pt-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Solo en local. Se queda abierto.</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => void open()}
        >
          {pending ? "Abriendo…" : "Ver Chrome"}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
