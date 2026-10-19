"use client"

import { useEffect, useState } from "react"

import { isApiConfigured } from "@/lib/api/config"
import { getWallapopAccountStatus } from "@/lib/api/wallapop-account"

const POLL_MS = 30_000

export function WallapopSessionNotice() {
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!isApiConfigured()) return
    let cancelled = false

    async function load() {
      try {
        const session = await getWallapopAccountStatus()
        if (cancelled) return
        const notice = session.status === "ACTIVE" ? null : session.error
        setMessage(notice ?? null)
      } catch {
        if (!cancelled) setMessage(null)
      }
    }

    void load()
    const timer = window.setInterval(() => void load(), POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  if (!message) return null
  return (
    <p
      className="border-b border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      role="alert"
    >
      {message}
    </p>
  )
}
