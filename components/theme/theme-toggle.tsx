"use client"

import { useLayoutEffect, useSyncExternalStore } from "react"
import { MoonIcon, SunIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { persistTheme, THEME_STORAGE_KEY } from "@/lib/theme-script"

function isDark() {
  return document.documentElement.classList.contains("dark")
}

function subscribe(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange)
  window.addEventListener("themechange", onStoreChange)
  return () => {
    window.removeEventListener("storage", onStoreChange)
    window.removeEventListener("themechange", onStoreChange)
  }
}

function applyTheme(dark: boolean) {
  persistTheme(dark)
  window.dispatchEvent(new Event("themechange"))
}

function storedTheme(): "dark" | "light" | null {
  const t = localStorage.getItem(THEME_STORAGE_KEY)
  return t === "dark" || t === "light" ? t : null
}

export function ThemeToggle({
  variant = "icon",
}: {
  variant?: "icon" | "row"
}) {
  const dark = useSyncExternalStore(subscribe, isDark, () => false)

  useLayoutEffect(() => {
    const saved = storedTheme()
    if (saved) {
      applyTheme(saved === "dark")
      return
    }
    applyTheme(matchMedia("(prefers-color-scheme: dark)").matches)
  }, [])

  function toggle() {
    applyTheme(!isDark())
  }

  const label = dark ? "Activar tema claro" : "Activar tema oscuro"

  if (variant === "row") {
    return (
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Apariencia</p>
          <p className="text-xs text-muted-foreground">
            {dark ? "Tema oscuro" : "Tema claro"}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={toggle}
          aria-label={label}
        >
          {dark ? <SunIcon /> : <MoonIcon />}
          {dark ? "Claro" : "Oscuro"}
        </Button>
      </div>
    )
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={toggle}
      aria-label={label}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </Button>
  )
}
