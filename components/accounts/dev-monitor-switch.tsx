"use client"

import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { fetchDevMonitor, setDevMonitor } from "@/lib/api/dev-monitor"
import { ApiError } from "@/lib/api/errors"

export function DevMonitorSwitch() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetchDevMonitor()
      .then((row) => {
        if (!cancelled) setEnabled(row.enabled)
      })
      .catch((error) => {
        if (cancelled || error instanceof ApiError) return
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (enabled === null) return null

  async function toggle() {
    if (enabled === null) return
    setPending(true)
    try {
      const next = await setDevMonitor(!enabled)
      setEnabled(next.enabled)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed px-3 py-2">
      <div>
        <p className="text-sm font-medium">Monitor</p>
        <p className="text-xs text-muted-foreground">
          Solo en local. El cliente no lo ve.
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => void toggle()}
      >
        {enabled ? "Apagar" : "Encender"}
      </Button>
    </div>
  )
}
