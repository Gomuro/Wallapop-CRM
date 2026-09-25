"use client"

import { useEffect } from "react"

import { ApiUnavailable } from "@/components/api/api-unavailable"
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
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <ApiUnavailable reason="unreachable" className="min-h-0 py-0" />
      <button
        type="button"
        className="text-sm text-muted-foreground underline"
        onClick={() => reset()}
      >
        Спробувати ще раз
      </button>
    </div>
  )
}
