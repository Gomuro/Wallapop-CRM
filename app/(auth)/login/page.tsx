import { Suspense } from "react"

import { LoginForm } from "@/components/auth/login-form"

export default function LoginPage() {
  return (
    <div
      className="flex min-h-dvh flex-col justify-center px-4 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]"
    >
      <Suspense fallback={<div className="text-center text-sm text-muted-foreground">Cargando…</div>}>
        <LoginForm />
      </Suspense>
    </div>
  )
}
