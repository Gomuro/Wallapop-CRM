"use client"

import { useCallback, useEffect, useState } from "react"
import { LoaderCircleIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { isApiConfigured } from "@/lib/api/config"
import {
  downloadDatabaseBackup,
  listDatabaseBackups,
  type ApiBackupFile,
} from "@/lib/api/backups"

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    dateStyle: "short",
    timeStyle: "short",
  })
}

function BackupFileList(props: {
  files: ApiBackupFile[]
  disabled: boolean
  onDownload: (file: string) => void
}) {
  if (props.files.length === 0) {
    return (
      <p className="mt-3 text-sm text-muted-foreground">
        Aún no hay copias. Crea una o espera al volcado diario del servidor.
      </p>
    )
  }
  return (
    <ul className="mt-4 space-y-2 text-sm">
      {props.files.map((row) => (
        <li key={row.file}>
          <button
            type="button"
            className="w-full rounded-lg border border-border px-3 py-2 text-left"
            onClick={() => props.onDownload(row.file)}
            disabled={props.disabled}
          >
            <span className="block font-medium">{formatWhen(row.mtime)}</span>
            <span className="text-muted-foreground">{formatBytes(row.size)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function DatabaseBackupCard() {
  const apiReady = isApiConfigured()
  const [files, setFiles] = useState<ApiBackupFile[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(apiReady)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const data = await listDatabaseBackups()
    setFiles(data.files)
  }, [])

  useEffect(() => {
    if (!apiReady) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      refresh()
        .catch((err) => {
          if (!cancelled) {
            setError(
              err instanceof Error ? err.message : "Error al listar copias.",
            )
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [apiReady, refresh])

  async function onDownload(file: string) {
    setError(null)
    setBusy(true)
    try {
      await downloadDatabaseBackup(file)
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo descargar.")
    } finally {
      setBusy(false)
    }
  }

  const latest = files[0]

  return (
    <div className="mx-auto mt-10 w-full max-w-md">
      <h2 className="text-lg font-semibold tracking-tight">Copia de seguridad</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Descarga la base de datos a tu ordenador y guárdala fuera de este
        servidor. El CRM guarda una copia al día (no en cada arranque). Si
        alguien borra el VPS, solo te quedará el archivo que hayas copiado tú.
      </p>
      {!apiReady ? (
        <p className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          La API no está configurada; no se pueden crear copias.
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex flex-col gap-2">
        <Button
          type="button"
          onClick={() => latest && onDownload(latest.file)}
          disabled={!apiReady || !latest || busy}
        >
          {busy ? (
            <LoaderCircleIcon className="size-4 animate-spin" />
          ) : null}
          Descargar la última
        </Button>
      </div>
      {loading ? (
        <p className="mt-3 text-sm text-muted-foreground">Cargando copias…</p>
      ) : (
        <BackupFileList
          files={files}
          disabled={busy}
          onDownload={onDownload}
        />
      )}
    </div>
  )
}
