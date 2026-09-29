"use client"

import { useState } from "react"
import { LoaderCircleIcon } from "lucide-react"

import {
  publishErrorMessage,
  publishProductDryRun,
} from "@/lib/api/publish"
import { Button } from "@/components/ui/button"

export function TestPublishButton({
  productId,
  disabled,
}: {
  productId: string
  disabled?: boolean
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function onClick() {
    if (pending || disabled) return
    setError(null)
    setSuccess(null)
    setPending(true)
    try {
      const result = await publishProductDryRun(productId)
      setSuccess(
        `Dry-run OK · paso ${result.step}${
          result.dryRun ? " (sin pulsar Publicar)" : ""
        }`,
      )
    } catch (caught) {
      setError(publishErrorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        variant="secondary"
        className="h-12 w-full"
        disabled={disabled || pending}
        aria-busy={pending || undefined}
        onClick={() => void onClick()}
      >
        {pending ? <LoaderCircleIcon className="animate-spin" /> : null}
        {pending ? "Probando…" : "Probar publicación"}
      </Button>
      {disabled ? (
        <p className="text-xs text-muted-foreground">
          Añade al menos una foto para probar la publicación.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Rellena el formulario en Chrome y para antes de Publicar.
        </p>
      )}
      {success ? (
        <p className="text-sm text-muted-foreground" role="status">
          {success}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
