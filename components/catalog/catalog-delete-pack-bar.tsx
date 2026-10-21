"use client"

import type { ReactNode } from "react"

import { ConfirmAction } from "@/components/confirm-action"
import type { AccountListingGlance } from "@/lib/inventory/types"
import { cn } from "@/lib/utils"

type QueueDialogProps = {
  open: boolean
  onOpenChange: (next: boolean) => void
  accountName: string | null
  toQueue: number
  already: number
  pending: boolean
  disabled: boolean
  note: string | null
  error: string | null
  autopostOn: boolean
  notice: ReactNode
  onConfirm: () => void
}

type RemoveDialogProps = {
  open: boolean
  onOpenChange: (next: boolean) => void
  selected: number
  progress: string | null
  error: string | null
  pending: boolean
  onConfirm: () => void
}

type CatalogDeletePackBarProps = {
  accounts: AccountListingGlance[]
  queueAccountId: string | null
  onQueueAccountId: (accountId: string) => void
  selectAllPending: boolean
  catalogEmpty: boolean
  onSelectAll: () => void
  onCancel: () => void
  queue: QueueDialogProps
  remove: RemoveDialogProps
}

function queueDescription(queue: QueueDialogProps): string {
  if (queue.note) return queue.note
  const name = queue.accountName ?? "esta cuenta"
  const entering =
    queue.toQueue > 0
      ? ` ${queue.toQueue} pasarán a «Listo para publicar» solo en esta cuenta.`
      : ""
  const untouched =
    queue.already > 0 ? ` ${queue.already} ya publicados aquí no se tocan.` : ""
  const autopost = queue.autopostOn
    ? " El autopost de esta cuenta está encendido: lo que entre en la cola se publicará de verdad."
    : ""
  return `Poner en cola no cambia un anuncio ya publicado ni lo devuelve a la cola. Si en ${name} ya está Publicado, se queda igual.${entering}${untouched} Las demás cuentas no cambian.${autopost}`
}

export function CatalogDeletePackBar({
  accounts,
  queueAccountId,
  onQueueAccountId,
  selectAllPending,
  catalogEmpty,
  onSelectAll,
  onCancel,
  queue,
  remove,
}: CatalogDeletePackBarProps) {
  return (
    <div className="sticky bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-30 mt-4 flex max-h-[min(22rem,calc(100dvh-9rem))] flex-col gap-2 overflow-y-auto rounded-2xl bg-background/95 p-3 shadow-lg ring-1 ring-border backdrop-blur md:bottom-3">
      <button
        type="button"
        className="h-11 w-full rounded-full bg-muted text-sm font-semibold disabled:opacity-50"
        disabled={selectAllPending || catalogEmpty}
        onClick={onSelectAll}
      >
        {selectAllPending ? "Cargando el catálogo…" : "Seleccionar todo"}
      </button>
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
                  active ? "bg-foreground text-background" : "bg-muted text-foreground",
                )}
                onClick={() => onQueueAccountId(account.accountId)}
              >
                {account.accountName}
              </button>
            )
          })}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <ConfirmAction
          open={queue.open}
          onOpenChange={queue.onOpenChange}
          triggerLabel={
            queue.accountName ? `Cola (${queue.toQueue})` : "Poner en cola"
          }
          triggerClassName="h-12 w-full px-2 text-sm"
          triggerDisabled={queue.disabled}
          title={queue.accountName ? `Cola de ${queue.accountName}` : "Cola"}
          description={queueDescription(queue)}
          confirmLabel="Poner en cola"
          pendingLabel="Guardando…"
          error={queue.error}
          notice={queue.notice}
          pending={queue.pending}
          onConfirm={queue.onConfirm}
        />
        <ConfirmAction
          open={remove.open}
          onOpenChange={remove.onOpenChange}
          triggerLabel={`Eliminar (${remove.selected})`}
          triggerClassName="h-12 w-full px-2 text-sm"
          triggerDisabled={remove.selected === 0}
          triggerVariant="destructive"
          title="Eliminar del catálogo"
          description={
            remove.progress ??
            "Se borran los productos elegidos del CRM. Si el anuncio sigue en Wallapop, primero se elimina allí."
          }
          confirmLabel="Eliminar"
          pendingLabel="En curso…"
          confirmVariant="destructive"
          error={remove.error}
          pending={remove.pending}
          onConfirm={remove.onConfirm}
        />
      </div>
      {queue.accountName && queue.already > 0 ? (
        <p className="text-center text-xs leading-snug text-muted-foreground">
          {queue.already} no entran: ya publicados o reservados en{" "}
          {queue.accountName}.
        </p>
      ) : null}
      <button type="button" className="h-11 text-sm font-semibold" onClick={onCancel}>
        Cancelar
      </button>
    </div>
  )
}
