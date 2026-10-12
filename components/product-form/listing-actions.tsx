"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { updateProductListingAction } from "@/app/actions/listing"
import { ConfirmAction } from "@/components/confirm-action"
import { actionFailureMessage, isNextRedirect } from "@/lib/api/action-error"
import {
  eliminarWallapopListing,
  wallapopEliminarErrorMessage,
} from "@/lib/api/wallapop-eliminar"

function useConfirmState() {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) setError(null)
  }
  return { open, setOpen, error, setError, pending, startTransition, onOpenChange }
}

/** Removes the listing on Wallapop only; the product stays in the CRM as Desactivado. */
export function EliminarWallapopButton({ productId }: { productId: string }) {
  const router = useRouter()
  const state = useConfirmState()

  function confirmEliminar() {
    state.setError(null)
    state.startTransition(async () => {
      try {
        const result = await eliminarWallapopListing(productId)
        if (result.dryRun) {
          state.setError(
            "Prueba: se encontró «Eliminar» en Wallapop y se paró antes de confirmar. El anuncio sigue publicado.",
          )
          return
        }
        state.setOpen(false)
        router.refresh()
      } catch (caught) {
        state.setError(wallapopEliminarErrorMessage(caught))
      }
    })
  }

  return (
    <ConfirmAction
      open={state.open}
      onOpenChange={state.onOpenChange}
      triggerLabel="Eliminar en Wallapop"
      triggerClassName="h-12 w-full"
      triggerVariant="secondary"
      title="Eliminar en Wallapop"
      description="Se borrará el anuncio en Wallapop (ventana aparte). El producto se queda en el CRM como Desactivado, con su stock. Para volver a publicarlo, ponlo después en cola: saldrá como anuncio nuevo."
      confirmLabel="Eliminar en Wallapop"
      pendingLabel="En Wallapop…"
      confirmVariant="destructive"
      error={state.error}
      pending={state.pending}
      onConfirm={confirmEliminar}
    />
  )
}

/** Desactivado → Listo para publicar. Autopost will post it as a new /item/. */
export function RequeueListingButton({ productId }: { productId: string }) {
  const router = useRouter()
  const state = useConfirmState()

  function confirmRequeue() {
    state.setError(null)
    state.startTransition(async () => {
      try {
        const formData = new FormData()
        formData.set("listingStatus", "READY_TO_POST")
        formData.set("clearListingUrl", "1")
        const result = await updateProductListingAction(productId, {}, formData)
        if (result.error) {
          state.setError(result.error)
          return
        }
        state.setOpen(false)
        router.refresh()
      } catch (caught) {
        if (isNextRedirect(caught)) throw caught
        state.setError(actionFailureMessage(caught))
      }
    })
  }

  return (
    <ConfirmAction
      open={state.open}
      onOpenChange={state.onOpenChange}
      triggerLabel="Poner en cola de publicación"
      triggerClassName="h-12 w-full"
      triggerVariant="secondary"
      title="Volver a publicar"
      description="El producto pasará a En venta y a «Listo para publicar». El autopost lo subirá a Wallapop como anuncio nuevo cuando toque."
      confirmLabel="Poner en cola"
      pendingLabel="Guardando…"
      error={state.error}
      pending={state.pending}
      onConfirm={confirmRequeue}
    />
  )
}
