import { clientApiV1Path } from "@/lib/api/config"
import { ApiError } from "@/lib/api/errors"
import { withApiTimeout } from "@/lib/api/http"
import { parseApiError } from "@/lib/api/parse-response"

/** Rendering up to 10 photos with ffmpeg on the VPS can take a while. */
const DUPLICATE_PHOTOS_TIMEOUT_MS = 120_000

function saveBlob(blob: Blob, fileName: string): void {
  const href = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = href
  link.download = fileName
  link.click()
  URL.revokeObjectURL(href)
}

/** Zip of the photos exactly as they go to Wallapop on this duplicate account, plus cambios.txt. */
export async function downloadDuplicatePhotos(
  productId: string,
  accountId: string,
): Promise<void> {
  const apiPath = `/products/${encodeURIComponent(productId)}/listings/${encodeURIComponent(accountId)}/duplicate-photos`
  let response: Response
  try {
    response = await fetch(
      clientApiV1Path(apiPath),
      withApiTimeout({ credentials: "include" }, DUPLICATE_PHOTOS_TIMEOUT_MS),
    )
  } catch {
    throw new ApiError(0, "NETWORK", "No se ha podido conectar con el servidor.")
  }
  if (!response.ok) throw await parseApiError(response)
  saveBlob(await response.blob(), `fotos-duplicado-${productId}.zip`)
}
