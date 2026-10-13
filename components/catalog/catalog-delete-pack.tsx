"use client"

import { useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"

import { ConfirmAction } from "@/components/confirm-action"
import {
  catalogDeleteErrorMessage,
  deleteProductFromCatalog,
} from "@/lib/api/catalog-delete"
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

  async function deleteSelected() {
    const ids = products
      .filter((product) => selected.has(product.id))
      .map((product) => product.id)
    setPackError(null)
    setPackPending(true)
    const removed: string[] = []
    try {
      for (const id of ids) {
        const result = await deleteProductFromCatalog(id)
        if (result.dryRun) {
          setPackError(result.error ?? "Prueba: el anuncio sigue en Wallapop.")
          break
        }
        removed.push(id)
      }
    } catch (caught) {
      setPackError(catalogDeleteErrorMessage(caught))
    } finally {
      setPackPending(false)
    }
    if (removed.length === 0) return
    onRemoved(removed)
    const next = new Set(selected)
    for (const id of removed) next.delete(id)
    onSelectedChange(next)
    if (removed.length === ids.length) {
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
              if (!next) setPackError(null)
            }}
            triggerLabel={`Eliminar del catálogo (${selected.size})`}
            triggerClassName="h-12 w-full"
            triggerDisabled={selected.size === 0}
            title="Eliminar del catálogo"
            description="Se borran los productos elegidos del CRM. Si el anuncio sigue en Wallapop (en venta, reservado o vendido), primero se elimina allí."
            confirmLabel="Eliminar"
            pendingLabel="Eliminando…"
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
