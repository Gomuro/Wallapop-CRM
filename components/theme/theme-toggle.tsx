"use client"

import { useSyncExternalStore } from "react"
import { MoonIcon, SunIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

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
  document.documentElement.classList.toggle("dark", dark)
  localStorage.setItem("theme", dark ? "dark" : "light")
  window.dispatchEvent(new Event("themechange"))
}

export function ThemeToggle({
  variant = "icon",
}: {
  variant?: "icon" | "row"
}) {
  const dark = useSyncExternalStore(subscribe, isDark, () => false)

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
