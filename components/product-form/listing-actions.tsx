"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { updateProductListingAction } from "@/app/actions/listing"
import { apiClientFetch } from "@/lib/api/client"
import { ApiError } from "@/lib/api/errors"
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

function withAccount(label: string, accountLabel?: string) {
  const name = accountLabel?.trim()
  return name ? `${label} · ${name}` : label
}

/** Removes the listing on Wallapop only; the product stays in the CRM as Desactivado. */
export function EliminarWallapopButton({
  productId,
  accountId,
  accountLabel,
}: {
  productId: string
  accountId?: string
  accountLabel?: string
}) {
  const router = useRouter()
  const state = useConfirmState()
  const [notice, setNotice] = useState<string | null>(null)

  function confirmEliminar() {
    state.setError(null)
    state.startTransition(async () => {
      try {
        const result = await eliminarWallapopListing(productId, accountId)
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
      triggerLabel={withAccount("Eliminar en Wallapop", accountLabel)}
      triggerClassName="h-12 w-full"
      triggerVariant="secondary"
      title={withAccount("Eliminar en Wallapop", accountLabel)}
      description="Se borrará el anuncio en Wallapop (ventana aparte). El producto se queda en el CRM como Desactivado, con su stock. Para volver a publicarlo, ponlo después en cola: saldrá como anuncio nuevo."
      confirmLabel={withAccount("Eliminar en Wallapop", accountLabel)}
      pendingLabel="En Wallapop…"
      confirmVariant="destructive"
      error={state.error}
      pending={state.pending}
      onConfirm={confirmEliminar}
    />
    </>
  )
}

/** No row yet on this account → its own READY_TO_POST. Other accounts stay as they are. */
export function QueueAccountButton({
  productId,
  accountId,
  accountLabel,
}: {
  productId: string
  accountId: string
  accountLabel: string
}) {
  const router = useRouter()
  const state = useConfirmState()

  function confirmQueue() {
    state.setError(null)
    state.startTransition(async () => {
      try {
        await apiClientFetch(`/products/${encodeURIComponent(productId)}/queue`, {
          method: "POST",
          body: JSON.stringify({ accountId }),
        })
        state.setOpen(false)
        router.refresh()
      } catch (caught) {
        if (isNextRedirect(caught)) throw caught
        state.setError(
          caught instanceof ApiError
            ? caught.message
            : actionFailureMessage(caught),
        )
      }
    })
  }

  return (
    <ConfirmAction
      open={state.open}
      onOpenChange={state.onOpenChange}
      triggerLabel="Poner en cola"
      triggerClassName="h-12 w-full"
      triggerVariant="secondary"
      title={`Publicar en ${accountLabel}`}
      description="Se pondrá en la cola de esta cuenta y saldrá como anuncio nuevo. Las demás cuentas no cambian."
      confirmLabel="Poner en cola"
      pendingLabel="Guardando…"
      error={state.error}
      pending={state.pending}
      onConfirm={confirmQueue}
    />
  )
}

/** Desactivado / desaparecido → Listo para publicar. Autopost will post it as a new /item/. */
export function RequeueListingButton({
  productId,
  accountId,
}: {
  productId: string
  accountId?: string
}) {
  const router = useRouter()
  const state = useConfirmState()

  function confirmRequeue() {
    state.setError(null)
    state.startTransition(async () => {
      try {
        const formData = new FormData()
        formData.set("listingStatus", "READY_TO_POST")
        formData.set("clearListingUrl", "1")
        if (accountId) formData.set("accountId", accountId)
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
  accountId,
  accountLabel,
}: {
  productId: string
  hasItemUrl: boolean
  accountId?: string
  accountLabel?: string
}) {
  const router = useRouter()
  const state = useConfirmState()
  const [notice, setNotice] = useState<string | null>(null)

  function confirmDevolucion() {
    state.setError(null)
    state.startTransition(async () => {
      try {
        const result = await startWallapopDevolucion(productId, accountId)
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
      triggerLabel={withAccount("Devolución", accountLabel)}
      triggerClassName="h-12 w-full"
      triggerVariant="default"
      title={withAccount("Devolución", accountLabel)}
      description={
        hasItemUrl
          ? "Se borrará el anuncio vendido de esta cuenta. El producto vuelve a En venta y cada cuenta que ya no tiene anuncio vuelve a la cola. Las que siguen publicadas no cambian. No se crea un producto nuevo."
          : "Esta cuenta ya no tiene anuncio. El producto vuelve a En venta y cada cuenta que ya no tiene anuncio vuelve a la cola. Las que siguen publicadas no cambian. No se crea un producto nuevo."
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
