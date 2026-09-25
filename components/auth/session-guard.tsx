"use client"

import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { getMe } from "@/lib/api/auth"
import { ApiError } from "@/lib/api/errors"

export function SessionGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function check() {
      try {
        await getMe()
        if (!cancelled) setReady(true)
      } catch (error) {
        if (cancelled) return
        const isUnauthorized =
          error instanceof ApiError && error.status === 401
        if (isUnauthorized) {
          const redirect = encodeURIComponent(pathname || "/")
          router.replace(`/login?redirect=${redirect}`)
          return
        }
        if (!cancelled) setReady(true)
      }
    }

    setReady(false)
    void check()

    return () => {
      cancelled = true
    }
  }, [pathname, router])

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
        Перевірка сесії…
      </div>
    )
  }

  return children
}
