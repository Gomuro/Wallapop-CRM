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

function withAccount(label: string, accountLabel?: string) {
  const name = accountLabel?.trim()
  return name ? `${label} · ${name}` : label
}

export function SoldSyncButton({
  productId,
  accountId,
  accountLabel,
  disabled,
}: {
  productId: string
  accountId?: string
  accountLabel?: string
  disabled?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [sold, setSold] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
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
        const result = await markWallapopSold(productId, accountId)
        if (result.dryRun) {
          setError(
            "Prueba: se encontró «Marcar como vendido» en Wallapop y se paró antes de confirmar. El anuncio no se ha vendido.",
          )
          return
        }
        if (result.queued) {
          setNotice(
            "Marcando como vendido en Wallapop. Puedes seguir en el catálogo; el estado está en Cuenta.",
          )
          setOpen(false)
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
    <>
      {notice ? (
        <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm" aria-live="polite">
          {notice}
        </p>
      ) : null}
    <ConfirmAction
      open={open}
      onOpenChange={handleOpenChange}
      triggerLabel={isSold ? "Vendido" : withAccount("Marcar como vendido", accountLabel)}
      triggerClassName="h-12 w-full"
      triggerVariant={isSold ? "secondary" : "default"}
      triggerDisabled={isSold}
      title={withAccount("Marcar como vendido", accountLabel)}
      description="Se marcará vendido en Wallapop (ventana aparte) y el producto pasará a Vendido en el CRM. Puedes seguir en el catálogo: el trabajo sigue en la cuenta. Si el comprador lo devuelve, usa Devolución."
      confirmLabel="Confirmar"
      pendingLabel="En Wallapop…"
      error={error}
      pending={pending}
      onConfirm={confirmSold}
    />
    </>
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
