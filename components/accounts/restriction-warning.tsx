"use client"

import { TriangleAlertIcon } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { dismissAccountRestriction, type ApiAccountCard } from "@/lib/api/account-cards"
import { ApiError } from "@/lib/api/errors"

/** Suspicion only: tells the operator why autopost stopped. Never a verdict. */
export function RestrictionWarning({ account }: { account: ApiAccountCard }) {
  const [dismissed, setDismissed] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!account.restrictionSuspectedAt || dismissed) return null

  async function dismiss() {
    setError(null)
    setPending(true)
    try {
      await dismissAccountRestriction(account.id)
      setDismissed(true)
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "No se pudo descartar el aviso.",
      )
      setPending(false)
    }
  }

  return (
    <div
      role="alert"
      className="mb-4 space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
    >
      <p className="flex items-center gap-2 font-medium text-destructive">
        <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
        Posible restricción de la cuenta
      </p>
      <p>{account.restrictionReason}</p>
      <p className="text-muted-foreground">
        Es una sospecha, no una confirmación. El autopost está parado hasta que
        descartes este aviso.
      </p>
      {error ? <p className="text-destructive">{error}</p> : null}
      <Button
        type="button"
        variant="outline"
        className="h-11 w-full"
        disabled={pending}
        onClick={() => {
          void dismiss()
        }}
      >
        {pending ? "Descartando…" : "Descartar aviso"}
      </Button>
    </div>
  )
}
