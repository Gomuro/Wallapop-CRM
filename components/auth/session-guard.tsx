"use client"

import { usePathname, useRouter } from "next/navigation"
import { useEffect, useRef } from "react"

import { ApiUnavailable } from "@/components/api/api-unavailable"
import { getMe } from "@/lib/api/auth"
import { isApiConfigured } from "@/lib/api/config"
import { ApiError } from "@/lib/api/errors"

export function SessionGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const pathnameRef = useRef(pathname)

  useEffect(() => {
    pathnameRef.current = pathname
  }, [pathname])

  useEffect(() => {
    if (!isApiConfigured()) return

    let cancelled = false

    async function check() {
      try {
        await getMe()
      } catch (error) {
        if (cancelled) return
        if (error instanceof ApiError && error.status === 401) {
          const redirect = encodeURIComponent(pathnameRef.current || "/")
          router.replace(`/login?redirect=${redirect}`)
        }
      }
    }

    void check()
    return () => {
      cancelled = true
    }
  }, [router])

  if (!isApiConfigured()) {
    return <ApiUnavailable reason="config" className="min-h-dvh" />
  }

  return children
}
