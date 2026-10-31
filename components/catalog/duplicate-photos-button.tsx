"use client"

import { useState } from "react"
import { DownloadIcon, LoaderCircleIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { downloadDuplicatePhotos } from "@/lib/api/duplicate-photos"

/** Downloads the duplicate's photos as Wallapop gets them, with a list of the changes. */
export function DuplicatePhotosButton({
  productId,
  accountId,
}: {
  productId: string
  accountId: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onDownload() {
    setError(null)
    setBusy(true)
    try {
      await downloadDuplicatePhotos(productId, accountId)
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron descargar las fotos.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="secondary"
        className="h-12 w-full"
        onClick={onDownload}
        disabled={busy}
      >
        {busy ? (
          <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
        ) : (
          <DownloadIcon className="size-4" aria-hidden />
        )}
        {busy ? "Preparando fotos…" : "Descargar fotos modificadas"}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
