"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { updateProductListingAction } from "@/app/actions/listing"
import { ConfirmAction } from "@/components/confirm-action"
import { actionFailureMessage, isNextRedirect } from "@/lib/api/action-error"
import {
  startWallapopDevolucion,
  wallapopDevolucionErrorMessage,
} from "@/lib/api/wallapop-devolucion"
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
  const [notice, setNotice] = useState<string | null>(null)

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
        if (result.queued) {
          setNotice(
            "Eliminando el anuncio en Wallapop. El producto se queda desactivado. Puedes seguir en el catálogo; el estado está en Cuenta.",
          )
          state.setOpen(false)
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
    <>
      {notice ? (
        <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm" aria-live="polite">
          {notice}
        </p>
      ) : null}
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
    </>
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

/** Sold return: Eliminar on Wallapop if the /item/ still exists, then same SKU to cola. */
export function DevolucionButton({
  productId,
  hasItemUrl,
}: {
  productId: string
  hasItemUrl: boolean
}) {
  const router = useRouter()
  const state = useConfirmState()
  const [notice, setNotice] = useState<string | null>(null)

  function confirmDevolucion() {
    state.setError(null)
    state.startTransition(async () => {
      try {
        const result = await startWallapopDevolucion(productId)
        if (result.dryRun) {
          state.setError(
            "Prueba: se encontró «Eliminar» en Wallapop y se paró antes de confirmar. El anuncio vendido sigue en Wallapop y el producto no ha vuelto a la cola.",
          )
          return
        }
        if (result.queued) {
          setNotice(
            "Eliminando el anuncio en Wallapop. El producto vuelve a la cola. Puedes seguir en el catálogo; el estado está en Cuenta.",
          )
          state.setOpen(false)
          return
        }
        state.setOpen(false)
        router.refresh()
      } catch (caught) {
        state.setError(wallapopDevolucionErrorMessage(caught))
      }
    })
  }

  return (
    <>
      {notice ? (
        <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm" aria-live="polite">
          {notice}
        </p>
      ) : null}
    <ConfirmAction
      open={state.open}
      onOpenChange={state.onOpenChange}
      triggerLabel="Devolución"
      triggerClassName="h-12 w-full"
      triggerVariant="default"
      title="Devolución"
      description={
        hasItemUrl
          ? "Se borrará el anuncio vendido en Wallapop (Eliminar) y el mismo producto volverá a En venta y a la cola de publicación. Puedes seguir en el catálogo: el trabajo sigue en la cuenta. No se crea un producto nuevo."
          : "El anuncio ya no tiene URL pública. El mismo producto volverá a En venta y a la cola de publicación. No se crea un producto nuevo."
      }
      confirmLabel="Confirmar devolución"
      pendingLabel={hasItemUrl ? "En Wallapop…" : "Guardando…"}
      error={state.error}
      pending={state.pending}
      onConfirm={confirmDevolucion}
    />
    </>
  )
}
