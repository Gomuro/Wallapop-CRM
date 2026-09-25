"use client"

import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { ApiUnavailable } from "@/components/api/api-unavailable"
import { getMe } from "@/lib/api/auth"
import type { ApiUnavailableReason } from "@/lib/api/availability"
import { isApiConfigured } from "@/lib/api/config"
import { ApiError } from "@/lib/api/errors"

type GuardState =
  | { kind: "checking" }
  | { kind: "ready" }
  | { kind: "unavailable"; reason: ApiUnavailableReason }

function failureReason(error: unknown): ApiUnavailableReason {
  if (!isApiConfigured()) return "config"
  if (error instanceof ApiError) {
    if (error.code === "API_NOT_CONFIGURED") return "config"
    if (error.code === "NETWORK" || error.status === 0) return "unreachable"
    if (error.status >= 502) return "unreachable"
    if (error.status === 404) return "unreachable"
  }
  return "unreachable"
}

export function SessionGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [state, setState] = useState<GuardState>({ kind: "checking" })

  useEffect(() => {
    let cancelled = false

    async function check() {
      if (!isApiConfigured()) {
        if (!cancelled) setState({ kind: "unavailable", reason: "config" })
        return
      }

      try {
        await getMe()
        if (!cancelled) setState({ kind: "ready" })
      } catch (error) {
        if (cancelled) return
        if (error instanceof ApiError && error.status === 401) {
          const redirect = encodeURIComponent(pathname || "/")
          router.replace(`/login?redirect=${redirect}`)
          return
        }
        setState({ kind: "unavailable", reason: failureReason(error) })
      }
    }

    setState({ kind: "checking" })
    void check()

    return () => {
      cancelled = true
    }
  }, [pathname, router])

  if (state.kind === "checking") {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
        Перевірка сесії…
      </div>
    )
  }

  if (state.kind === "unavailable") {
    return <ApiUnavailable reason={state.reason} className="min-h-dvh" />
  }

  return children
}
