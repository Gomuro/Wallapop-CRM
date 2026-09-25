"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { LogOutIcon } from "lucide-react"

import { getMe, logout } from "@/lib/api/auth"
import { Button } from "@/components/ui/button"

export function AuthUserMenu() {
  const router = useRouter()
  const [name, setName] = useState<string | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    let cancelled = false
    getMe()
      .then((user) => {
        if (!cancelled) setName(user.name)
      })
      .catch(() => {
        if (!cancelled) setName(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function onLogout() {
    setLoggingOut(true)
    try {
      await logout()
    } finally {
      router.replace("/login")
      router.refresh()
      setLoggingOut(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {name ? (
        <span className="max-w-[10rem] truncate text-sm text-muted-foreground" title={name}>
          {name}
        </span>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onLogout}
        disabled={loggingOut}
        aria-label="Cerrar sesión"
      >
        <LogOutIcon />
        <span className="hidden lg:inline">Cerrar sesión</span>
      </Button>
    </div>
  )
}
