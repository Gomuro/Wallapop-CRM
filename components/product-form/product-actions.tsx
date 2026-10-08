"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import {
  deleteProductAction,
  markProductSoldAction,
} from "@/app/actions/products"
import { actionFailureMessage, isNextRedirect } from "@/lib/api/action-error"
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
        const result = await markProductSoldAction(productId)
        if (result.error) {
          setError(result.error)
          return
        }
        setSold(true)
        setOpen(false)
        router.refresh()
      } catch (caught) {
        if (isNextRedirect(caught)) throw caught
        setError(actionFailureMessage(caught))
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
      description="El producto pasará a Vendido y se desactivarán todos los anuncios vinculados."
      confirmLabel="Confirmar"
      pendingLabel="Sincronizando…"
      error={error}
      pending={pending}
      onConfirm={confirmSold}
    />
  )
}

export function DeleteProductButton({ productId }: { productId: string }) {
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
      triggerLabel="Eliminar"
      triggerClassName="h-12 w-full text-destructive"
      triggerVariant="ghost"
      title="Eliminar producto"
      description="Se quitará del catálogo. Esta acción no se puede deshacer en esta sesión."
      confirmLabel="Eliminar"
      pendingLabel="Eliminando…"
      confirmVariant="destructive"
      error={error}
      pending={pending}
      onConfirm={() => {
        setError(null)
        startTransition(async () => {
          try {
            const result = await deleteProductAction(productId)
            if (result?.error) setError(result.error)
          } catch (caught) {
            if (isNextRedirect(caught)) throw caught
            setError(actionFailureMessage(caught))
          }
        })
      }}
    />
  )
}
