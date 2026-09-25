"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { EyeIcon, EyeOffIcon } from "lucide-react"

import { login, loginErrorMessage } from "@/lib/api/auth"
import { isApiConfigured } from "@/lib/api/config"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get("redirect") || "/"

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const apiReady = isApiConfigured()

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    const trimmedEmail = email.trim()
    if (!trimmedEmail || !password) {
      setError("Introduce el email y la contraseña.")
      return
    }

    setPending(true)
    try {
      await login(trimmedEmail, password)
      router.replace(redirectTo.startsWith("/") ? redirectTo : "/")
      router.refresh()
    } catch (err) {
      setError(loginErrorMessage(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="mb-8 text-center">
        <p className="text-lg font-semibold tracking-tight">Wallapop CRM</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Acceso para el operador
        </p>
      </div>

      {!apiReady ? (
        <p className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
          La API no está configurada en este entorno. El acceso no funcionará
          hasta que se defina NEXT_PUBLIC_API_PROXY (Vercel → VPS) o
          NEXT_PUBLIC_API_URL.
        </p>
      ) : null}

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            className="h-12 text-base md:h-10 md:text-sm"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={pending}
            required
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Contraseña</Label>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              className="h-12 pr-12 text-base md:h-10 md:text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={pending}
              required
            />
            <button
              type="button"
              className="absolute top-1/2 right-1 flex size-10 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
              onClick={() => setShowPassword((open) => !open)}
              aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              aria-pressed={showPassword}
            >
              {showPassword ? (
                <EyeOffIcon className="size-5" />
              ) : (
                <EyeIcon className="size-5" />
              )}
            </button>
          </div>
        </div>

        {error ? (
          <p className="text-sm text-destructive" role="alert">{error}</p>
        ) : null}

        <Button
          type="submit"
          className="mt-2 h-12 w-full text-base md:h-10 md:text-sm"
          disabled={pending}
        >
          {pending ? "Entrando…" : "Entrar"}
        </Button>
      </form>
    </div>
  )
}
