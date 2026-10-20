import { apiClientFetch } from "@/lib/api/client"
import { ApiError } from "@/lib/api/errors"
import { catalogDeleteNeedsWallapop } from "@/lib/inventory/listing-active"
import type { InventoryProduct } from "@/lib/inventory/types"

export function deleteProgressText(
  index: number,
  total: number,
  product: InventoryProduct,
): string {
  const onWallapop =
    product.listingActive === true ||
    catalogDeleteNeedsWallapop({
      status: product.status,
      listing: product.listing,
    })
  const step = `${index + 1} de ${total}: ${product.title}`
  if (onWallapop) {
    return `${step}. Primero se quita el anuncio en Wallapop; puede tardar.`
  }
  return `${step}. Se elimina del CRM.`
}

export async function postProductToQueue(
  productId: string,
  accountId: string,
  signal: AbortSignal,
): Promise<"queued" | "skipped" | "aborted"> {
  try {
    await apiClientFetch(`/products/${encodeURIComponent(productId)}/queue`, {
      method: "POST",
      body: JSON.stringify({ accountId }),
      signal,
    })
    return "queued"
  } catch (caught) {
    if (signal.aborted) return "aborted"
    if (caught instanceof ApiError && caught.status === 409) return "skipped"
    throw caught
  }
}

type QueueWalk = {
  products: InventoryProduct[]
  accountId: string
  signal: AbortSignal
  onNote: (note: string) => void
}

export async function walkQueue(input: QueueWalk): Promise<{
  queued: string[]
  skipped: number
  stopped: boolean
}> {
  const queued: string[] = []
  let skipped = 0
  for (let index = 0; index < input.products.length; index += 1) {
    if (input.signal.aborted) return { queued, skipped, stopped: true }
    const product = input.products[index]
    if (!product) continue
    input.onNote(`${index + 1} de ${input.products.length}: ${product.title}`)
    const outcome = await postProductToQueue(
      product.id,
      input.accountId,
      input.signal,
    )
    if (outcome === "aborted") return { queued, skipped, stopped: true }
    if (outcome === "skipped") {
      skipped += 1
      continue
    }
    queued.push(product.id)
  }
  return { queued, skipped, stopped: false }
}

const ALREADY_QUEUED =
  "Esos productos ya están publicados, se están publicando o están inactivos en esta cuenta."

export function queueResultView(result: {
  queued: number
  skipped: number
  stopped: boolean
  planned: number
  thrown: string | null
}): { error: string | null; close: boolean; refresh: boolean } {
  const nothingNew =
    result.queued === 0 && result.skipped > 0 && !result.stopped && !result.thrown
  const finished =
    result.stopped ||
    (result.skipped === 0 && result.queued === result.planned && !result.thrown)
  return {
    error: result.thrown ?? (nothingNew ? ALREADY_QUEUED : null),
    close: finished,
    refresh: result.queued > 0 || result.stopped,
  }
}

export function queueFailureMessage(caught: unknown, aborted: boolean): string | null {
  if (aborted) return null
  if (caught instanceof ApiError) return caught.message
  return "No se ha podido poner en cola."
}
