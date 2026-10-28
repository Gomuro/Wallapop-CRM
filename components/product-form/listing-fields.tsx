"use client"

import { useRouter } from "next/navigation"
import { useActionState, useEffect, useState } from "react"

import {
  updateProductListingAction,
  type ListingActionState,
} from "@/app/actions/listing"
import { ClearListingLinkButton } from "@/components/catalog/clear-listing-link-button"
import { ListingStatusBadge } from "@/components/catalog/listing-status-badge"
import { ListingFormBody } from "@/components/product-form/listing-form-body"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { formatListingPostedAt } from "@/lib/inventory/format"
import { computeListingActive } from "@/lib/inventory/listing-active"
import { actionFailureMessage, isNextRedirect } from "@/lib/api/action-error"
import type { InventoryListing, InventoryProduct } from "@/lib/inventory/types"
import { wallapopItemUrlOrNull } from "@/lib/inventory/wallapop-item-url"
import type { ListingStatus } from "@/lib/validations"
import { typeMeta, typeSection } from "@/lib/ui/type"

function writableListingStatus(
  status: InventoryListing["status"] | undefined,
): ListingStatus {
  if (
    status === "ACTIVE" ||
    status === "RESERVED" ||
    status === "MISSING" ||
    status === "DEACTIVATED"
  ) {
    return status
  }
  return "READY_TO_POST"
}

function blankListing(accountId: string, accountName: string): InventoryListing {
  return {
    id: accountId,
    accountId,
    accountName,
    externalUrl: null,
    status: "READY_TO_POST",
    lastPostedAt: null,
    shippingEnabled: true,
  }
}

async function submitListing(
  action: (prev: ListingActionState, formData: FormData) => Promise<ListingActionState>,
  prev: ListingActionState,
  formData: FormData,
): Promise<ListingActionState> {
  try {
    return await action(prev, formData)
  } catch (error) {
    if (isNextRedirect(error)) throw error
    return { error: actionFailureMessage(error) }
  }
}

function syncListingStatus(
  status: InventoryListing["status"] | undefined,
  seen: InventoryListing["status"] | undefined,
  setSeen: (value: InventoryListing["status"] | undefined) => void,
  setStatus: (value: ListingStatus) => void,
) {
  if (status === seen) return
  setSeen(status)
  if (status && status !== "POSTING" && status !== "PREPARING") {
    setStatus(writableListingStatus(status))
  }
}

function useListingErrorFocus(
  state: ListingActionState,
  accountId: string | undefined,
  listingAccountId: string | undefined,
) {
  useEffect(() => {
    if (!state.error && !state.fieldErrors) return
    const key = state.fieldErrors ? Object.keys(state.fieldErrors)[0] : undefined
    const scope = accountId || listingAccountId || "default"
    const scoped = key === "externalUrl" ? `externalUrl-${scope}` : key
    const target =
      (scoped ? document.getElementById(scoped) : null) ??
      document.getElementById(`listing-form-error-${scope}`)
    target?.scrollIntoView({ behavior: "smooth", block: "center" })
    if (target instanceof HTMLElement) target.focus()
  }, [state, accountId, listingAccountId])
}

function ListingFieldsEmpty() {
  return (
    <Card className="gap-3 overflow-visible py-3 shadow-none">
      <CardHeader className="px-3">
        <h2 className={typeSection}>Anuncio en Wallapop</h2>
      </CardHeader>
      <CardContent className="px-3">
        <p className="text-sm text-muted-foreground">
          La cuenta de Wallapop no está configurada. El anuncio aparecerá
          cuando se complete la configuración.
        </p>
      </CardContent>
    </Card>
  )
}

function ListingAccountCard({
  productId,
  warehouseStatus,
  resolvedName,
  resolvedAccountId,
  shown,
  itemUrl,
  junkUrl,
  isPosting,
  pending,
  status,
  onStatusChange,
  formAction,
  state,
  scope,
}: {
  productId: string
  warehouseStatus: InventoryProduct["status"]
  resolvedName: string
  resolvedAccountId: string
  shown: InventoryListing
  itemUrl: string | null
  junkUrl: boolean
  isPosting: boolean
  pending: boolean
  status: ListingStatus
  onStatusChange: (value: ListingStatus) => void
  formAction: (payload: FormData) => void
  state: ListingActionState
  scope: string
}) {
  return (
    <Card className="gap-0 overflow-hidden py-0 shadow-none">
      <CardHeader className="flex flex-row items-center justify-between gap-2 bg-muted/50 px-3 py-2.5">
        <div className="min-w-0">
          <h2 className={typeSection}>{resolvedName || "Anuncio en Wallapop"}</h2>
          <p className={typeMeta}>
            {resolvedName ? "Anuncio en Wallapop" : "Se guarda aparte del producto."}
          </p>
        </div>
        <ListingStatusBadge
          product={{
            status: warehouseStatus,
            listing: shown,
            listingActive: computeListingActive(shown),
          }}
          className="shrink-0"
        />
      </CardHeader>
      <CardContent className="space-y-3 px-3 py-3">
        {junkUrl ? (
          <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm leading-snug text-muted-foreground">
            El enlace guardado no es un anuncio publicado (página de alta o
            inicio). El autopost no lo cogerá hasta que lo quites.
          </p>
        ) : null}
        <ListingFormBody
          listing={shown}
          itemUrl={itemUrl}
          junkUrl={junkUrl}
          isPosting={isPosting}
          pending={pending}
          status={status}
          onStatusChange={onStatusChange}
          formAction={formAction}
          state={state}
          accountId={resolvedAccountId}
          scope={scope}
        />
        {junkUrl && !isPosting ? (
          <ClearListingLinkButton productId={productId} accountId={resolvedAccountId} />
        ) : null}
        {itemUrl && shown.lastPostedAt ? (
          <p className="text-xs text-muted-foreground">
            Publicado {formatListingPostedAt(shown.lastPostedAt)}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function ListingFields({
  productId,
  listing,
  warehouseStatus,
  accountId,
  accountName,
}: {
  productId: string
  listing: InventoryListing | null
  warehouseStatus: InventoryProduct["status"]
  accountId?: string
  accountName?: string
}) {
  const router = useRouter()
  const boundAction = updateProductListingAction.bind(null, productId)
  const [state, formAction, pending] = useActionState(
    (prev: ListingActionState, formData: FormData) =>
      submitListing(boundAction, prev, formData),
    {} as ListingActionState,
  )
  const [status, setStatus] = useState<ListingStatus>(writableListingStatus(listing?.status))
  const [seenListingStatus, setSeenListingStatus] = useState(listing?.status)
  syncListingStatus(listing?.status, seenListingStatus, setSeenListingStatus, setStatus)
  useListingErrorFocus(state, accountId, listing?.accountId)
  useEffect(() => {
    if (state.success) router.refresh()
  }, [state.success, router])

  const resolvedAccountId = accountId || listing?.accountId || ""
  const resolvedName = accountName?.trim() || listing?.accountName?.trim() || ""
  const shown = listing ?? (resolvedAccountId ? blankListing(resolvedAccountId, resolvedName) : null)
  if (!shown) return <ListingFieldsEmpty />

  return (
    <ListingAccountCard
      productId={productId}
      warehouseStatus={warehouseStatus}
      resolvedName={resolvedName}
      resolvedAccountId={resolvedAccountId}
      shown={shown}
      itemUrl={wallapopItemUrlOrNull(shown.externalUrl)}
      junkUrl={Boolean(shown.externalUrl) && !wallapopItemUrlOrNull(shown.externalUrl)}
      isPosting={shown.status === "POSTING"}
      pending={pending}
      status={status}
      onStatusChange={setStatus}
      formAction={formAction}
      state={state}
      scope={resolvedAccountId || "default"}
    />
  )
}

function cardsFor(product: InventoryProduct): {
  accountId: string
  accountName: string
  listing: InventoryListing | null
}[] {
  const listings =
    product.listings && product.listings.length > 0
      ? product.listings
      : product.listing
        ? [product.listing]
        : []
  if (product.accountStates && product.accountStates.length > 0) {
    return product.accountStates.map((state) => ({
      accountId: state.accountId,
      accountName: state.accountName,
      listing: listings.find((row) => row.accountId === state.accountId) ?? null,
    }))
  }
  if (product.listing) {
    return [
      {
        accountId: product.listing.accountId,
        accountName: product.listing.accountName ?? "Cuenta",
        listing: product.listing,
      },
    ]
  }
  return []
}

export function ListingFieldsList({ product }: { product: InventoryProduct }) {
  const cards = cardsFor(product)
  if (cards.length === 0) {
    return (
      <ListingFields
        productId={product.id}
        listing={null}
        warehouseStatus={product.status}
      />
    )
  }
  return (
    <div className="flex flex-col gap-4">
      {cards.map((card) => (
        <ListingFields
          key={card.accountId || "default"}
          productId={product.id}
          listing={card.listing}
          accountId={card.accountId}
          accountName={card.accountName}
          warehouseStatus={product.status}
        />
      ))}
    </div>
  )
}
