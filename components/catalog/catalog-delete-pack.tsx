"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"

import { CatalogDeletePackBar } from "@/components/catalog/catalog-delete-pack-bar"
import {
  deleteProgressText,
  queueFailureMessage,
  queueResultView,
  walkQueue,
} from "@/components/catalog/catalog-delete-pack-run"
import {
  catalogDeleteErrorMessage,
  deleteProductFromCatalog,
} from "@/lib/api/catalog-delete"
import { getAccountAutopost } from "@/lib/api/wallapop-account"
import { accountGlanceAlreadyQueued } from "@/lib/inventory/format"
import type { AccountListingGlance, InventoryProduct } from "@/lib/inventory/types"

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
  if (!row) return false
  return accountGlanceAlreadyQueued(row)
}

function soldQueueNotice(soldInQueue: number): ReactNode {
  if (soldInQueue < 1) return null
  const text =
    soldInQueue === 1
      ? "Cuidado: 1 vendido también entra en la cola y puede publicarse otra vez."
      : `Cuidado: ${soldInQueue} vendidos también entran en la cola y pueden publicarse otra vez.`
  return (
    <p className="text-sm font-bold uppercase leading-snug text-destructive" role="note">
      {text}
    </p>
  )
}

function useAutopostEnabled(open: boolean, accountId: string | null) {
  const [autopostOn, setAutopostOn] = useState(false)
  useEffect(() => {
    if (!open || !accountId) return
    let cancelled = false
    void getAccountAutopost(accountId)
      .then((next) => {
        if (!cancelled) setAutopostOn(next.autopost.enabled)
      })
      .catch(() => {
        if (!cancelled) setAutopostOn(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, accountId])
  return { autopostOn, setAutopostOn }
}

type CatalogDeletePackProps = {
  products: InventoryProduct[]
  selecting: boolean
  selected: Set<string>
  queueAccountId: string | null
  onQueueAccountId: (accountId: string) => void
  onSelectingChange: (next: boolean) => void
  onSelectedChange: (next: Set<string>) => void
  onRemoved: (ids: string[]) => void
  onQueued: (ids: string[], accountId: string) => void
  onSelectAll: () => void
  selectAllPending?: boolean
  children: ReactNode
}

function chosenForAccount(products: InventoryProduct[], selected: Set<string>, accountId: string | null) {
  const chosen = products.filter((product) => selected.has(product.id))
  if (!accountId) return { toQueue: [] as InventoryProduct[], already: chosen.length }
  const toQueue = chosen.filter((product) => !staysOnAccount(product, accountId))
  return { toQueue, already: chosen.length - toQueue.length }
}

function usePackDelete(props: CatalogDeletePackProps) {
  const router = useRouter()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [packError, setPackError] = useState<string | null>(null)
  const [packPending, setPackPending] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)

  async function deleteSelected() {
    const queue = props.products.filter((product) => props.selected.has(product.id))
    setPackError(null)
    setPackPending(true)
    const removed = await deletePack(queue, setProgress, setPackError, props.onRemoved)
    setPackPending(false)
    setProgress(null)
    if (removed.length === 0) return
    const next = new Set(props.selected)
    for (const id of removed) next.delete(id)
    props.onSelectedChange(next)
    if (removed.length === queue.length) {
      setConfirmOpen(false)
      props.onSelectingChange(false)
    }
    router.refresh()
  }

  return {
    confirmOpen,
    setConfirmOpen,
    packError,
    setPackError,
    packPending,
    progress,
    setProgress,
    deleteSelected,
  }
}

function usePackQueue(props: CatalogDeletePackProps, toQueue: InventoryProduct[], accountId: string | null) {
  const router = useRouter()
  const [queueOpen, setQueueOpen] = useState(false)
  const [queueError, setQueueError] = useState<string | null>(null)
  const [queuePending, setQueuePending] = useState(false)
  const [queueNote, setQueueNote] = useState<string | null>(null)
  const queueAbort = useRef<AbortController | null>(null)
  const { autopostOn, setAutopostOn } = useAutopostEnabled(queueOpen, accountId)

  async function queueSelected() {
    if (!accountId) return
    const controller = new AbortController()
    queueAbort.current = controller
    setQueueError(null)
    setQueuePending(true)
    const walked = await runQueueWalk(toQueue, accountId, controller, setQueueNote)
    if (queueAbort.current === controller) queueAbort.current = null
    setQueuePending(false)
    setQueueNote(null)
    if (walked.queued.length > 0) props.onQueued(walked.queued, accountId)
    const view = queueResultView({
      queued: walked.queued.length,
      skipped: walked.skipped,
      stopped: walked.stopped,
      planned: toQueue.length,
      thrown: walked.thrown,
    })
    if (view.error) setQueueError(view.error)
    if (view.close) setQueueOpen(false)
    if (view.refresh) router.refresh()
  }

  function onQueueOpenChange(next: boolean) {
    if (!next && queuePending) {
      queueAbort.current?.abort()
      setQueueNote("Cancelando…")
      return
    }
    setQueueOpen(next)
    if (!next) {
      setQueueError(null)
      setQueueNote(null)
      setAutopostOn(false)
    }
  }

  return {
    queueOpen,
    queueError,
    queuePending,
    queueNote,
    autopostOn,
    queueSelected,
    onQueueOpenChange,
  }
}

async function runQueueWalk(
  products: InventoryProduct[],
  accountId: string,
  controller: AbortController,
  onNote: (note: string) => void,
) {
  let thrown: string | null = null
  let walked = { queued: [] as string[], skipped: 0, stopped: false }
  try {
    walked = await walkQueue({
      products,
      accountId,
      signal: controller.signal,
      onNote,
    })
  } catch (caught) {
    thrown = queueFailureMessage(caught, controller.signal.aborted)
    if (controller.signal.aborted) walked = { ...walked, stopped: true }
  }
  return { ...walked, thrown }
}

export function CatalogDeletePack(props: CatalogDeletePackProps) {
  const accounts = accountsInView(props.products)
  const queueAccount =
    accounts.find((row) => row.accountId === props.queueAccountId) ?? null
  const { toQueue, already } = chosenForAccount(
    props.products,
    props.selected,
    queueAccount?.accountId ?? null,
  )
  const soldInQueue = toQueue.filter((product) => product.status === "SOLD").length
  const pack = usePackDelete(props)
  const queue = usePackQueue(props, toQueue, queueAccount?.accountId ?? null)

  return (
    <>
      {props.children}
      {props.selecting ? (
        <CatalogDeletePackBar
          accounts={accounts}
          queueAccountId={props.queueAccountId}
          onQueueAccountId={props.onQueueAccountId}
          selectAllPending={props.selectAllPending ?? false}
          catalogEmpty={props.products.length === 0}
          onSelectAll={props.onSelectAll}
          onCancel={() => {
            props.onSelectingChange(false)
            props.onSelectedChange(new Set())
          }}
          queue={{
            open: queue.queueOpen,
            onOpenChange: queue.onQueueOpenChange,
            accountName: queueAccount?.accountName ?? null,
            toQueue: toQueue.length,
            already,
            pending: queue.queuePending,
            disabled: !queueAccount || toQueue.length === 0 || queue.queuePending,
            note: queue.queueNote,
            error: queue.queueError,
            autopostOn: queue.autopostOn,
            notice: soldQueueNotice(soldInQueue),
            onConfirm: () => {
              void queue.queueSelected()
            },
          }}
          remove={{
            open: pack.confirmOpen,
            onOpenChange: (next) => {
              if (pack.packPending) return
              pack.setConfirmOpen(next)
              if (!next) {
                pack.setPackError(null)
                pack.setProgress(null)
              }
            },
            selected: props.selected.size,
            progress: pack.progress,
            error: pack.packError,
            pending: pack.packPending,
            onConfirm: () => {
              void pack.deleteSelected()
            },
          }}
        />
      ) : null}
    </>
  )
}

async function deletePack(
  queue: InventoryProduct[],
  setProgress: (value: string | null) => void,
  setPackError: (value: string | null) => void,
  onRemoved: (ids: string[]) => void,
): Promise<string[]> {
  const removed: string[] = []
  try {
    for (let index = 0; index < queue.length; index += 1) {
      const product = queue[index]
      if (!product) continue
      setProgress(deleteProgressText(index, queue.length, product))
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
  }
  return removed
}
