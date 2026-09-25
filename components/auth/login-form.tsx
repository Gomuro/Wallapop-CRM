"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"

import { login, loginErrorMessage } from "@/lib/api/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get("redirect") || "/"

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    const trimmedEmail = email.trim()
    if (!trimmedEmail || !password) {
      setError("Введіть email і пароль")
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
        <p className="mt-1 text-sm text-muted-foreground">Вхід для оператора складу</p>
      </div>

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
          <Label htmlFor="password">Пароль</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            className="h-12 text-base md:h-10 md:text-sm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={pending}
            required
          />
        </div>

        {error ? (
          <p className="text-sm text-destructive" role="alert">{error}</p>
        ) : null}

        <Button
          type="submit"
          className="mt-2 h-12 w-full text-base md:h-10 md:text-sm"
          disabled={pending}
        >
          {pending ? "Вхід…" : "Увійти"}
        </Button>
      </form>
    </div>
  )
}
