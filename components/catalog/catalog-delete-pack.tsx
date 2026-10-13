"use client"

import { useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"

import { ConfirmAction } from "@/components/confirm-action"
import {
  catalogDeleteErrorMessage,
  deleteProductFromCatalog,
} from "@/lib/api/catalog-delete"
import { catalogDeleteNeedsWallapop } from "@/lib/inventory/listing-active"
import type { InventoryProduct } from "@/lib/inventory/types"

export function CatalogDeletePack({
  products,
  selecting,
  selected,
  onSelectingChange,
  onSelectedChange,
  onRemoved,
  children,
}: {
  products: InventoryProduct[]
  selecting: boolean
  selected: Set<string>
  onSelectingChange: (next: boolean) => void
  onSelectedChange: (next: Set<string>) => void
  onRemoved: (ids: string[]) => void
  children: ReactNode
}) {
  const router = useRouter()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [packError, setPackError] = useState<string | null>(null)
  const [packPending, setPackPending] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)

  async function deleteSelected() {
    const queue = products.filter((product) => selected.has(product.id))
    setPackError(null)
    setPackPending(true)
    const removed: string[] = []
    try {
      for (let index = 0; index < queue.length; index += 1) {
        const product = queue[index]
        if (!product) continue
        const onWallapop =
          product.listingActive === true ||
          catalogDeleteNeedsWallapop({
            status: product.status,
            listing: product.listing,
          })
        setProgress(
          onWallapop
            ? `${index + 1} de ${queue.length}: ${product.title}. Primero se quita el anuncio en Wallapop; puede tardar.`
            : `${index + 1} de ${queue.length}: ${product.title}. Se elimina del CRM.`,
        )
        const result = await deleteProductFromCatalog(product.id)
        if (result.dryRun) {
          setPackError(result.error ?? "Prueba: el anuncio sigue en Wallapop.")
          break
        }
        removed.push(product.id)
        onRemoved([product.id])
      }
    } catch (caught) {
      setPackError(catalogDeleteErrorMessage(caught))
    } finally {
      setPackPending(false)
      setProgress(null)
    }
    if (removed.length === 0) return
    const next = new Set(selected)
    for (const id of removed) next.delete(id)
    onSelectedChange(next)
    if (removed.length === queue.length) {
      setConfirmOpen(false)
      onSelectingChange(false)
    }
    router.refresh()
  }

  return (
    <>
      {children}
      {selecting ? (
        <div className="sticky bottom-3 z-30 mt-4 flex flex-col gap-2">
          <button
            type="button"
            className="h-11 text-sm font-semibold"
            onClick={() => {
              onSelectingChange(false)
              onSelectedChange(new Set())
            }}
          >
            Cancelar
          </button>
          <ConfirmAction
            open={confirmOpen}
            onOpenChange={(next) => {
              if (packPending) return
              setConfirmOpen(next)
              if (!next) {
                setPackError(null)
                setProgress(null)
              }
            }}
            triggerLabel={`Eliminar del catálogo (${selected.size})`}
            triggerClassName="h-12 w-full"
            triggerDisabled={selected.size === 0}
            title="Eliminar del catálogo"
            description={
              progress ??
              "Se borran los productos elegidos del CRM. Si el anuncio sigue en Wallapop, primero se elimina allí."
            }
            confirmLabel="Eliminar"
            pendingLabel="En curso…"
            confirmVariant="destructive"
            error={packError}
            pending={packPending}
            onConfirm={() => {
              void deleteSelected()
            }}
          />
        </div>
      ) : null}
    </>
  )
}
