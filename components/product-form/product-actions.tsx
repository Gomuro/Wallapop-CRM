"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { markProductInactiveAction } from "@/app/actions/products"
import { actionFailureMessage, isNextRedirect } from "@/lib/api/action-error"
import {
  catalogDeleteErrorMessage,
  deleteProductFromCatalog,
} from "@/lib/api/catalog-delete"
import {
  markWallapopSold,
  wallapopSoldErrorMessage,
} from "@/lib/api/wallapop-sold"
import { ConfirmAction } from "@/components/confirm-action"

export function SoldSyncButton({
  productId,
  disabled,
}: {
  productId: string
  disabled?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [sold, setSold] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const isSold = disabled || sold

  function handleOpenChange(next: boolean) {
    if (isSold) {
      setOpen(false)
      return
    }
    setOpen(next)
    if (!next) setError(null)
  }

  function confirmSold() {
    setError(null)
    startTransition(async () => {
      try {
        const result = await markWallapopSold(productId)
        if (result.dryRun) {
          setError(
            "Prueba: se encontró «Marcar como vendido» en Wallapop y se paró antes de confirmar. El anuncio no se ha vendido.",
          )
          return
        }
        if (result.queued) {
          setOpen(false)
          router.refresh()
          return
        }
        setSold(true)
        setOpen(false)
        router.refresh()
      } catch (caught) {
        setError(wallapopSoldErrorMessage(caught))
      }
    })
  }

  return (
    <ConfirmAction
      open={open}
      onOpenChange={handleOpenChange}
      triggerLabel={isSold ? "Vendido" : "Marcar como vendido"}
      triggerClassName="h-12 w-full"
      triggerVariant={isSold ? "secondary" : "default"}
      triggerDisabled={isSold}
      title="Marcar como vendido"
      description="Se marcará vendido en Wallapop (ventana aparte) y el producto pasará a Vendido en el CRM. Puedes seguir en el catálogo: el trabajo sigue en la cuenta. Si el comprador lo devuelve, usa Devolución."
      confirmLabel="Confirmar"
      pendingLabel="En Wallapop…"
      error={error}
      pending={pending}
      onConfirm={confirmSold}
    />
  )
}

export function MarkInactiveButton({ productId }: { productId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <ConfirmAction
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setError(null)
      }}
      triggerLabel="Marcar como inactivo"
      triggerClassName="h-12 w-full"
      triggerVariant="secondary"
      title="Marcar como inactivo"
      description="El producto pasará a Inactivo en el CRM y saldrá de la cola de publicación. Wallapop no se toca: esta acción sólo vale si el anuncio no está publicado."
      confirmLabel="Marcar inactivo"
      pendingLabel="Guardando…"
      error={error}
      pending={pending}
      onConfirm={() => {
        setError(null)
        startTransition(async () => {
          try {
            const result = await markProductInactiveAction(productId)
            if (result?.error) {
              setError(result.error)
              return
            }
            setOpen(false)
            router.refresh()
          } catch (caught) {
            if (isNextRedirect(caught)) throw caught
            setError(actionFailureMessage(caught))
          }
        })
      }}
    />
  )
}

export function DeleteProductButton({ productId }: { productId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <ConfirmAction
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setError(null)
      }}
      triggerLabel="Eliminar del catálogo"
      triggerClassName="h-12 w-full text-destructive"
      triggerVariant="ghost"
      title="Eliminar del catálogo"
      description="Se borra el producto del CRM. Si el anuncio sigue en Wallapop (en venta, reservado o vendido), primero se elimina allí."
      confirmLabel="Eliminar del todo"
      pendingLabel="Eliminando…"
      confirmVariant="destructive"
      error={error}
      pending={pending}
      onConfirm={() => {
        setError(null)
        startTransition(async () => {
          try {
            const result = await deleteProductFromCatalog(productId)
            if (result.dryRun) {
              setError(result.error ?? "Prueba: el anuncio sigue en Wallapop.")
              return
            }
            router.push("/")
            router.refresh()
          } catch (caught) {
            setError(catalogDeleteErrorMessage(caught))
          }
        })
      }}
    />
  )
}
