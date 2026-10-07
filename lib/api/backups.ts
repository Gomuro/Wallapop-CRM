import { apiClientFetch } from "@/lib/api/client"
import { clientApiV1Path } from "@/lib/api/config"
import { ApiError } from "@/lib/api/errors"
import { withApiTimeout } from "@/lib/api/http"
import { parseApiError } from "@/lib/api/parse-response"

export type ApiBackupFile = {
  file: string
  size: number
  mtime: string
}

export async function listDatabaseBackups(): Promise<{ files: ApiBackupFile[] }> {
  return apiClientFetch("/backups")
}

export async function downloadDatabaseBackup(file: string): Promise<void> {
  let response: Response
  try {
    response = await fetch(
      clientApiV1Path(`/backups/${encodeURIComponent(file)}`),
      withApiTimeout({ credentials: "include" }, 120_000),
    )
  } catch {
    throw new ApiError(0, "NETWORK", "No se ha podido conectar con el servidor.")
  }
  if (!response.ok) throw await parseApiError(response)
  const blob = await response.blob()
  const href = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = href
  link.download = file
  link.click()
  URL.revokeObjectURL(href)
}
