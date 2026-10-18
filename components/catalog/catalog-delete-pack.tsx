"use client"

import { useEffect, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"

import { ConfirmAction } from "@/components/confirm-action"
import { apiClientFetch } from "@/lib/api/client"
import { ApiError } from "@/lib/api/errors"
import {
  catalogDeleteErrorMessage,
  deleteProductFromCatalog,
} from "@/lib/api/catalog-delete"
import { getAccountAutopost } from "@/lib/api/wallapop-account"
import { catalogDeleteNeedsWallapop } from "@/lib/inventory/listing-active"
import { accountGlanceIsLive } from "@/lib/inventory/format"
import type { AccountListingGlance, InventoryProduct } from "@/lib/inventory/types"
import { cn } from "@/lib/utils"

function accountsInView(products: InventoryProduct[]): AccountListingGlance[] {
  for (const product of products) {
    if (product.accountStates && product.accountStates.length > 0) {
      return product.accountStates
    }
  }
  return []
}

function staysOnAccount(product: InventoryProduct, accountId: string): boolean {
  const row = product.accountStates?.find((state) => state.accountId === accountId)
  if (!row || row.status == null) return false
  if (row.status === "READY_TO_POST" || row.status === "POSTING") return true
  return accountGlanceIsLive(row)
}

export function CatalogDeletePack({
  products,
  selecting,
  selected,
  queueAccountId,
  onQueueAccountId,
  onSelectingChange,
  onSelectedChange,
  onRemoved,
  onQueued,
  children,
}: {
  products: InventoryProduct[]
  selecting: boolean
  selected: Set<string>
  queueAccountId: string | null
  onQueueAccountId: (accountId: string) => void
  onSelectingChange: (next: boolean) => void
  onSelectedChange: (next: Set<string>) => void
  onRemoved: (ids: string[]) => void
  onQueued: (ids: string[], accountId: string) => void
  children: ReactNode
}) {
  const router = useRouter()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [packError, setPackError] = useState<string | null>(null)
  const [packPending, setPackPending] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [queueOpen, setQueueOpen] = useState(false)
  const [queueError, setQueueError] = useState<string | null>(null)
  const [queuePending, setQueuePending] = useState(false)
  const [queueNote, setQueueNote] = useState<string | null>(null)
  const [autopostOn, setAutopostOn] = useState(false)
  const accounts = accountsInView(products)
  const queueAccount = accounts.find((row) => row.accountId === queueAccountId) ?? null
  const chosen = products.filter((product) => selected.has(product.id))
  const toQueue = queueAccount
    ? chosen.filter((product) => !staysOnAccount(product, queueAccount.accountId))
    : []
  const already = chosen.length - toQueue.length

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

  useEffect(() => {
    if (!queueOpen || !queueAccount) return
    let cancelled = false
    void getAccountAutopost(queueAccount.accountId)
      .then((next) => {
        if (!cancelled) setAutopostOn(next.autopost.enabled)
      })
      .catch(() => {
        if (!cancelled) setAutopostOn(false)
      })
    return () => {
      cancelled = true
    }
  }, [queueOpen, queueAccount?.accountId])

  async function queueSelected() {
    if (!queueAccount) return
    setQueueError(null)
    setQueuePending(true)
    const queued: string[] = []
    let skipped = 0
    try {
      for (let index = 0; index < toQueue.length; index += 1) {
        const product = toQueue[index]
        if (!product) continue
        setQueueNote(`${index + 1} de ${toQueue.length}: ${product.title}`)
        try {
          await apiClientFetch(`/products/${encodeURIComponent(product.id)}/queue`, {
            method: "POST",
            body: JSON.stringify({ accountId: queueAccount.accountId }),
          })
          queued.push(product.id)
        } catch (caught) {
          if (caught instanceof ApiError && caught.status === 409) {
            skipped += 1
            continue
          }
          throw caught
        }
      }
    } catch (caught) {
      setQueueError(caught instanceof ApiError ? caught.message : "No se ha podido poner en cola.")
    } finally {
      setQueuePending(false)
      setQueueNote(null)
    }
    if (queued.length === 0) return
    onQueued(queued, queueAccount.accountId)
    if (skipped === 0 && queued.length === toQueue.length) {
      setQueueOpen(false)
    }
    router.refresh()
  }

  return (
    <>
      {children}
      {selecting ? (
        <div className="sticky bottom-3 z-30 mt-4 flex flex-col gap-2 rounded-2xl bg-background/95 p-3 shadow-lg ring-1 ring-border backdrop-blur">
          {accounts.length > 0 ? (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {accounts.map((account) => {
                const active = account.accountId === queueAccountId
                return (
                  <button
                    key={account.accountId}
                    type="button"
                    className={cn(
                      "h-10 shrink-0 rounded-full px-3 text-sm font-medium",
                      active
                        ? "bg-foreground text-background"
                        : "bg-muted text-foreground",
                    )}
                    onClick={() => onQueueAccountId(account.accountId)}
                  >
                    {account.accountName}
                  </button>
                )
              })}
            </div>
          ) : null}
          <ConfirmAction
            open={queueOpen}
            onOpenChange={(next) => {
              if (queuePending) return
              setQueueOpen(next)
              if (!next) {
                setQueueError(null)
                setQueueNote(null)
                setAutopostOn(false)
              }
            }}
            triggerLabel={
              queueAccount
                ? `Poner en cola · ${queueAccount.accountName} (${toQueue.length})`
                : "Poner en cola"
            }
            triggerClassName="h-12 w-full"
            triggerDisabled={!queueAccount || toQueue.length === 0 || queuePending}
            title={queueAccount ? `Cola de ${queueAccount.accountName}` : "Cola"}
            description={
              queueNote ??
              `Poner en cola no cambia un anuncio ya publicado ni lo devuelve a la cola. Si en ${
                queueAccount?.accountName ?? "esta cuenta"
              } ya está Publicado, se queda igual.${
                toQueue.length > 0
                  ? ` ${toQueue.length} pasarán a «Listo para publicar» solo en esta cuenta.`
                  : ""
              }${
                already > 0
                  ? ` ${already} ya publicados aquí no se tocan.`
                  : ""
              } Las demás cuentas no cambian.${
                autopostOn
                  ? " El autopost de esta cuenta está encendido: lo que entre en la cola se publicará de verdad."
                  : ""
              }`
            }
            confirmLabel="Poner en cola"
            pendingLabel="Guardando…"
            error={queueError}
            pending={queuePending}
            onConfirm={() => {
              void queueSelected()
            }}
          />
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
